// Everything the website lets a person do with their own finances, as MCP tools (the assistant acts as the person, only when
// they allowed it). Same rules as the app (src/store, src/domain): money in the currency's smallest unit (the tools take whole
// units like 49.90), nothing is ever deleted (removing archives, and archived things can be restored), every document goes
// through the same validators as the API, and everything is looked up inside the connected person's own rows only.
import { randomBytes } from 'node:crypto';
import type { McpTool, ToolCtx } from './mcp-tools.js';
import { digitsOf } from './assistant-write.js';
import { readAll, upsertDocs, withTransaction, type Docs } from './db.js';
import {
  BUILTIN_EXPENSE, BUILTIN_INCOME, CARD_COLORS, IMPACT_LEVELS, TONE_LIST, addMonthsToKey, buildOccurrences, builtinRecordId, categoryViews, fixedFieldsAt, findInvoice, invoicesNow,
  isDate, isMonthKey, monthKey, norm, openInvoiceKey, parseISO, remaining, toneFromWeight,
  type Card, type CategoryRecord, type CategoryView, type OccurrenceFields, type Payment, type Tone, type Tx,
} from './finance.js';
import { validate, ValidationError, type Collection, type Doc } from './validate.js';
import { LANGUAGES } from './settings.js';

const fail = (message: string): never => {
  throw new ValidationError(message);
};
const newId = () => Date.now().toString(36) + randomBytes(4).toString('hex');
const MAX_MINOR = 100_000_000_000;

/** Removes undefined values (the validators refuse a key that is present but empty). */
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const without = <T extends object>(o: T, keys: string[]): T => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T;

interface World {
  txs: Tx[];
  cards: Card[];
  payments: Payment[];
  records: CategoryRecord[];
  currency: string;
  digits: number;
}

async function load(ctx: ToolCtx): Promise<World> {
  const all = await readAll(ctx.pool, ctx.userId);
  const s = await ctx.pool.query('select currency from settings where user_id = $1', [ctx.userId]);
  const currency = (s.rows[0]?.currency as string | undefined) ?? 'USD';
  const records = (all.categories as unknown as CategoryRecord[]).map((r) => ({ ...r, ...(r.weight !== undefined ? { weight: Number(r.weight) } : {}) }));
  return { txs: all.transactions as unknown as Tx[], cards: all.cards as unknown as Card[], payments: all.payments as unknown as Payment[], records, currency, digits: digitsOf(currency) };
}

/** Validates every document with the API's own validators and writes them in one transaction. */
async function save(ctx: ToolCtx, docs: Partial<Record<Collection, Doc[]>>): Promise<void> {
  for (const [collection, list] of Object.entries(docs) as [Collection, Doc[]][]) {
    for (const d of list) {
      const message = validate(collection, d);
      if (message) fail(message);
    }
  }
  await withTransaction(ctx.pool, (client) => upsertDocs(client, ctx.userId, docs as Docs));
}

const only = (args: Record<string, unknown>, allowed: string[]) => {
  for (const k of Object.keys(args)) if (!allowed.includes(k)) fail(`unknown argument "${k}". Arguments: ${allowed.join(', ')}`);
};
const str = (args: Record<string, unknown>, k: string, max: number, required = true): string | undefined => {
  const v = args[k];
  if (v === undefined || v === null) return required ? fail(`"${k}" is required`) : undefined;
  if (typeof v !== 'string' || !v.trim() || [...v.trim()].length > max || v.includes('\u0000')) fail(`"${k}" must be text of 1 to ${max} characters`);
  return (v as string).trim();
};
const money = (args: Record<string, unknown>, k: string, digits: number, required = true): number | undefined => {
  const v = args[k];
  if (v === undefined || v === null) return required ? fail(`"${k}" is required`) : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(`"${k}" must be a positive number in whole units of the currency, like 49.90`);
  const minor = Math.round((v as number) * 10 ** digits);
  if (minor <= 0 || minor > MAX_MINOR) fail(`"${k}" is out of range`);
  return minor;
};
const optDate = (args: Record<string, unknown>, k: string, today: string): string | undefined => {
  const v = args[k];
  if (v === undefined || v === null) return undefined;
  if (!isDate(v)) fail(`"${k}" must be a real date as YYYY-MM-DD`);
  // a typo like 2062 must not move something decades away
  if (Math.abs(Number((v as string).slice(0, 4)) - Number(today.slice(0, 4))) > 2) fail(`"${k}" is more than two years from today`);
  return v as string;
};
const fmt = (minor: number, w: World) => (minor / 10 ** w.digits).toFixed(w.digits);
const unit = (minor: number, w: World) => Number((minor / 10 ** w.digits).toFixed(w.digits));

/** Finds one item by name (case and accent insensitive; exact first, then partial). Refuses unknown and ambiguous names. */
function byName<T>(items: T[], raw: unknown, what: string, nameOf: (t: T) => string, all: string[] = items.map(nameOf)): T {
  if (typeof raw !== 'string' || !raw.trim()) return fail(`the ${what} is required`);
  const n = norm(raw);
  const exact = items.filter((i) => norm(nameOf(i)) === n);
  const found = exact.length ? exact : items.filter((i) => norm(nameOf(i)).includes(n));
  if (found.length === 1) return found[0] as T;
  if (found.length > 1) return fail(`"${raw}" matches more than one ${what}: ${found.map(nameOf).join(', ')}. Use the full name.`);
  return fail(`unknown ${what} "${raw}". ${what === 'category' ? 'Categories' : 'Options'}: ${all.join(', ') || 'none'}`);
}
const cardNamed = (w: World, raw: unknown, archived: boolean): Card => {
  const list = w.cards.filter((c) => !!c.archivedAt === archived);
  return byName(list, raw, `${archived ? 'archived ' : ''}card`, (c) => c.name, list.length ? list.map((c) => c.name) : [archived ? 'no archived cards' : 'no cards registered']);
};
const activeCard = (w: World, raw: unknown): Card => cardNamed(w, raw, false);
const cardName = (w: World, id?: string) => (id ? w.cards.find((c) => c.id === id)?.name : undefined);

function categoryNamed(w: World, raw: unknown, kind: 'expense' | 'income' | undefined, archived: boolean): CategoryView {
  const views = categoryViews(w.records).filter((c) => (!kind || c.kind === kind) && c.archived === archived);
  const n = typeof raw === 'string' ? norm(raw) : '';
  if (!n) return fail('the category is required');
  const exact = views.filter((c) => norm(c.name) === n || norm(c.slug) === n);
  const found = exact.length ? exact : views.filter((c) => norm(c.name).includes(n));
  if (found.length === 1) return found[0] as CategoryView;
  if (found.length > 1) return fail(`"${String(raw)}" matches more than one category: ${found.map((c) => `${c.name} (${c.kind})`).join(', ')}. Use the full name${kind ? '' : ' and the "kind"'}.`);
  return fail(`unknown ${archived ? 'archived ' : ''}category "${String(raw)}". Categories: ${views.map((c) => (kind ? c.name : `${c.name} (${c.kind})`)).join(', ') || 'none'}`);
}

const txNamed = (w: World, raw: unknown): Tx => {
  if (typeof raw !== 'string' || !raw) return fail('"id" is required (the id from search_transactions)');
  return w.txs.find((t) => t.id === raw) ?? fail('no transaction with that id. Use search_transactions to find the right id.');
};

const kindOption = { type: 'string', enum: ['expense', 'income'] } as const;
const tool = (name: string, scope: McpTool['scope'], description: string, properties: Record<string, unknown>, required: string[], handler: McpTool['handler']): McpTool => ({
  name,
  scope,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  handler: (ctx, args) => {
    only(args, Object.keys(properties));
    return handler(ctx, args);
  },
});

// ------------------------------------------------------------------ reads

const searchTransactions = tool(
  'search_transactions',
  'read',
  'Searches the person\'s transactions live (archived ones are left out unless archived: true). Monthly (fixed) transactions are listed one line per month. Use the returned id with the update, confirm and archive tools. Amounts are in whole units of the currency.',
  {
    query: { type: 'string', description: 'Text to find in the description (case and accent insensitive).' },
    from: { type: 'string', description: 'YYYY-MM-DD, earliest purchase date.' },
    to: { type: 'string', description: 'YYYY-MM-DD, latest purchase date.' },
    type: kindOption,
    category: { type: 'string', description: 'A category name or slug.' },
    card: { type: 'string', description: 'A credit card name; only that card\'s purchases.' },
    limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to return, newest first (default 20).' },
    archived: { type: 'boolean', description: 'true to list the archived transactions instead (to find one to restore).' },
  },
  [],
  async (ctx, a) => {
    const w = await load(ctx);
    const from = a.from === undefined ? undefined : isDate(a.from) ? a.from : fail('"from" must be YYYY-MM-DD');
    const to = a.to === undefined ? undefined : isDate(a.to) ? a.to : fail('"to" must be YYYY-MM-DD');
    const type = a.type === undefined ? undefined : a.type === 'expense' || a.type === 'income' ? a.type : fail('"type" must be "expense" or "income"');
    const limit = a.limit === undefined ? 20 : Number.isInteger(a.limit) && (a.limit as number) >= 1 && (a.limit as number) <= 50 ? (a.limit as number) : fail('"limit" must be a whole number from 1 to 50');
    const q = typeof a.query === 'string' && a.query.trim() ? norm(a.query) : undefined;
    const card = a.card === undefined ? undefined : byName(w.cards, a.card, 'card', (c) => c.name);
    const views = categoryViews(w.records);
    const cats = a.category === undefined ? undefined : views.filter((c) => norm(c.name) === norm(String(a.category)) || c.slug === norm(String(a.category)));
    if (cats && cats.length === 0) fail(`unknown category "${String(a.category)}". Categories: ${[...new Set(views.map((c) => c.name))].join(', ')}`);
    const until = [to ? monthKey(to) : undefined, monthKey(ctx.today)].filter(Boolean).sort().at(-1) as string;
    const live = w.txs.filter((t) => !!t.archivedAt === (a.archived === true));
    const rows = buildOccurrences(live, w.cards, until)
      .filter((o) => (!from || o.purchaseDate >= from) && (!to || o.purchaseDate <= to) && (!type || o.type === type) && (!card || o.cardId === card.id) && (!q || norm(o.description).includes(q)))
      .filter((o) => !cats || cats.some((c) => c.slug === o.category && c.kind === o.type))
      .sort((x, y) => y.purchaseDate.localeCompare(x.purchaseDate) || y.order - x.order);
    const out = rows.slice(0, limit).map((o) => ({
      id: o.transactionId,
      date: o.purchaseDate,
      description: o.description,
      amount: unit(o.amount, w),
      type: o.type,
      ...(o.category ? { category: o.category } : {}),
      confirmed: o.confirmed,
      fixed: o.fixed,
      ...(o.fixed ? { month: o.monthKey } : {}),
      ...(o.cardId ? { card: cardName(w, o.cardId) } : {}),
      ...(o.installment ? { installment: { index: o.installment.index, total: o.installment.total } } : {}),
      ...(o.invoiceKey ? { invoiceKey: o.invoiceKey } : {}),
    }));
    return JSON.stringify({ currency: w.currency, matches: rows.length, shown: out.length, transactions: out });
  },
);

const listInvoices = tool(
  'list_invoices',
  'read',
  'The credit card invoices, live: for each card its limit, due day and the invoices from about 6 months back to 6 ahead (due month, due date, total on it, paid, remaining). Income on a card (a refund) reduces the invoice. Amounts in whole units.',
  { card: { type: 'string', description: 'Only this card (by name).' } },
  [],
  async (ctx, a) => {
    const w = await load(ctx);
    const cards = a.card === undefined ? w.cards.filter((c) => !c.archivedAt) : [byName(w.cards, a.card, 'card', (c) => c.name)];
    const invoices = invoicesNow(w.txs, w.cards, w.payments, ctx.today);
    const now = monthKey(ctx.today);
    const lo = addMonthsToKey(now, -6);
    const hi = addMonthsToKey(now, 6);
    return JSON.stringify({
      currency: w.currency,
      today: ctx.today,
      cards: cards.map((c) => {
        const open = openInvoiceKey(c, ctx.today);
        const keys = new Set([open, ...invoices.filter((i) => i.cardId === c.id && i.key >= lo && i.key <= hi && (i.total !== 0 || i.paid > 0)).map((i) => i.key)]);
        return {
          name: c.name,
          limit: unit(c.limit, w),
          dueDay: c.dueDay,
          ...(c.color ? { color: c.color } : {}),
          archived: !!c.archivedAt,
          openInvoice: open,
          invoices: [...keys].sort().map((key) => {
            const inv = findInvoice(invoices, c, key);
            return { invoice: key, dueDate: inv.dueDate, total: unit(inv.total, w), paid: unit(inv.paid, w), remaining: unit(remaining(inv), w), open: key === open };
          }),
        };
      }),
    });
  },
);

const listPayments = tool(
  'list_payments',
  'read',
  'Recent credit card invoice payments (newest first, up to 50) with their ids, to archive one that was a mistake.',
  { card: { type: 'string', description: 'Only this card (by name).' }, archived: { type: 'boolean', description: 'true to list the archived payments instead (to restore one).' } },
  [],
  async (ctx, a) => {
    const w = await load(ctx);
    const card = a.card === undefined ? undefined : byName(w.cards, a.card, 'card', (c) => c.name);
    const wantArchived = a.archived === true;
    const list = w.payments
      .filter((p) => !!p.archivedAt === wantArchived && (!card || p.cardId === card.id))
      .sort((x, y) => y.date.localeCompare(x.date))
      .slice(0, 50);
    return JSON.stringify({ currency: w.currency, payments: list.map((p) => ({ id: p.id, card: cardName(w, p.cardId) ?? 'unknown card', invoice: p.invoiceKey, amount: unit(p.amount, w), date: p.date })) });
  },
);

// ------------------------------------------------------------------ transactions

/** Port of store.updateFixed: edits a fixed transaction in a month ("one") or from that month on ("forward"). */
function applyFixedChange(t: Tx, month: string, changes: OccurrenceFields, scope: 'one' | 'forward'): Tx {
  const next: Tx = { ...t };
  const keys = (['description', 'amount', 'category', 'day'] as const).filter((k) => changes[k] !== undefined) as string[];
  if (keys.length === 0) return next;
  if (scope === 'one') {
    next.overrides = { ...(t.overrides ?? {}), [month]: { ...(t.overrides?.[month] ?? {}), ...changes } };
    return next;
  }
  // "this and following": anything later with the same fields is superseded
  const revisions = (t.revisions ?? []).map((r) => (r.from > month ? (without(r, keys) as typeof r) : r)).filter((r) => Object.keys(r).length > 1);
  const same = revisions.find((r) => r.from === month);
  next.revisions = same ? revisions.map((r) => (r === same ? { ...r, ...changes } : r)) : [...revisions, { from: month, ...changes }];
  if (t.overrides) {
    const overrides = Object.fromEntries(
      Object.entries(t.overrides)
        .map(([m, o]) => [m, m >= month ? without(o, keys) : o] as const)
        .filter(([, o]) => Object.keys(o).length > 0),
    );
    if (Object.keys(overrides).length === 0) delete next.overrides;
    else next.overrides = overrides;
  }
  return next;
}

const dropEmpty = (t: Tx): Tx => {
  const next = { ...t };
  if (next.revisions && next.revisions.length === 0) delete next.revisions;
  if (next.overrides && Object.keys(next.overrides).length === 0) delete next.overrides;
  return next;
};

/** Checks the category for a kind and returns its slug. A built-in category the person archived is not offered. */
function categorySlug(w: World, raw: string, kind: 'expense' | 'income'): string {
  const views = categoryViews(w.records).filter((c) => c.kind === kind);
  const n = norm(raw);
  const hit = views.find((c) => norm(c.name) === n || norm(c.slug) === n) ?? fail(`unknown ${kind} category "${raw}". Categories: ${views.filter((c) => !c.archived).map((c) => c.name).join(', ')}`);
  if ((hit as CategoryView).archived) fail(`the category "${raw}" is archived`);
  return (hit as CategoryView).slug;
}

const monthArg = (a: Record<string, unknown>, ctx: ToolCtx, t: Tx): string => {
  const m = a.month === undefined ? monthKey(ctx.today) : a.month;
  if (!isMonthKey(m)) return fail('"month" must be YYYY-MM');
  if (m < monthKey(t.date)) fail(`this monthly transaction starts in ${monthKey(t.date)}; "month" cannot be earlier`);
  return m;
};

const updateTransaction = tool(
  'update_transaction',
  'write',
  'Edits one transaction (use the id from search_transactions). For installments, description, category and card apply to the whole group, amount/date/confirmed only to that installment. For a monthly (fixed) transaction, "scope" says how far the change goes: this_month (only that month, the default), from_this_month (that month and the following) or all (the whole series); "month" is the month being edited (default the current one). A card purchase is never confirmed. Confirm the change with the person first.',
  {
    id: { type: 'string', description: 'The transaction id from search_transactions.' },
    description: { type: 'string', description: 'New description, 1 to 100 characters.' },
    amount: { type: 'number', description: 'New amount, positive, whole units like 49.90 (for installments: that installment).' },
    date: { type: 'string', description: 'New date YYYY-MM-DD (for a monthly transaction only its day of the month matters, except with scope "all", which moves the start).' },
    category: { type: 'string', description: 'A category name or slug of the transaction\'s type.' },
    confirmed: { type: 'boolean', description: 'true when it already happened. For monthly ones it applies to "month".' },
    card: { type: 'string', description: 'A credit card name to put it on that card; "none" to take it off the card (back to the account).' },
    scope: { type: 'string', enum: ['this_month', 'from_this_month', 'all'], description: 'Only for monthly (fixed) transactions.' },
    month: { type: 'string', description: 'YYYY-MM, only for monthly (fixed) transactions.' },
  },
  ['id'],
  async (ctx, a) => {
    const w = await load(ctx);
    const t = txNamed(w, a.id);
    if (t.archivedAt) fail('that transaction is archived; restore it first (restore_transaction)');
    const description = str(a, 'description', 100, false);
    const amount = money(a, 'amount', w.digits, false);
    const date = optDate(a, 'date', ctx.today);
    if (a.confirmed !== undefined && typeof a.confirmed !== 'boolean') fail('"confirmed" must be true or false');
    const confirmed = a.confirmed as boolean | undefined;
    const scopeRaw = a.scope;
    if (scopeRaw !== undefined && scopeRaw !== 'this_month' && scopeRaw !== 'from_this_month' && scopeRaw !== 'all') fail('"scope" must be this_month, from_this_month or all');
    if (a.scope !== undefined && !t.fixed) fail('"scope" only applies to monthly (fixed) transactions');
    if (a.month !== undefined && !t.fixed) fail('"month" only applies to monthly (fixed) transactions');
    if (a.category !== undefined && typeof a.category !== 'string') fail('"category" must be text');
    if (a.card !== undefined && typeof a.card !== 'string') fail('"card" must be text');
    if ([a.description, a.amount, a.date, a.category, a.confirmed, a.card].every((v) => v === undefined)) fail('nothing to change: give at least one of description, amount, date, category, confirmed, card');

    // the card after the change
    let card: Card | undefined = t.cardId ? w.cards.find((c) => c.id === t.cardId) : undefined;
    let cardChanged = false;
    if (typeof a.card === 'string') {
      if (['none', 'account', ''].includes(norm(a.card))) {
        cardChanged = !!t.cardId;
        card = undefined;
      } else {
        if (t.type === 'income') fail('income cannot go on a card');
        if (t.reserveId) fail('this expense is paid from a reserve; it cannot also go on a card');
        const picked = activeCard(w, a.card);
        cardChanged = picked.id !== t.cardId;
        card = picked;
      }
    }
    const kind = t.type;
    const category = typeof a.category === 'string' ? (kind === 'income' && card ? fail('income on a card is a refund and has no category') : categorySlug(w, a.category, kind)) : undefined;
    const finalCategory = category ?? t.category;
    if (finalCategory === 'loan' && kind === 'expense' && !card) fail('a Loan is money lent on a card: it needs a card');
    if (confirmed === true && card) fail('a card purchase is never confirmed; it is paid with the invoice (pay_invoice)');

    const changes: string[] = [];
    const docs: Tx[] = [];
    const mark = (s: string) => changes.push(s);

    if (t.fixed) {
      const scope = (scopeRaw as 'this_month' | 'from_this_month' | 'all' | undefined) ?? 'this_month';
      const month = monthArg(a, ctx, t);
      let next: Tx = { ...t };
      // series-level: the card (and its invoice) always applies to the whole series
      if (cardChanged) {
        if (card) {
          next.cardId = card.id;
          next.invoiceKey = t.invoiceKey ?? addMonthsToKey(openInvoiceKey(card, t.date), 1);
          next.confirmedMonths = [];
          mark(`card ${card.name}`);
        } else {
          delete next.cardId;
          delete next.invoiceKey;
          mark('taken off the card');
        }
      }
      if (scope === 'all') {
        const keys: string[] = [];
        if (description !== undefined && description !== t.description) (next.description = description), keys.push('description'), mark(`description "${description}"`);
        if (amount !== undefined && amount !== t.amount) (next.amount = amount), keys.push('amount'), mark(`amount ${fmt(amount, w)}`);
        if (category !== undefined && category !== t.category) (next.category = category), keys.push('category'), mark(`category ${category}`);
        if (date !== undefined && date !== t.date) (next.date = date), keys.push('day'), mark(`start date ${date}`);
        if (keys.length) {
          if (next.revisions) next.revisions = next.revisions.map((r) => without(r, keys) as typeof r).filter((r) => Object.keys(r).length > 1);
          if (next.overrides) next.overrides = Object.fromEntries(Object.entries(next.overrides).map(([m, o]) => [m, without(o, keys)] as const).filter(([, o]) => Object.keys(o).length > 0));
        }
      } else {
        if (date !== undefined && monthKey(date) !== month) fail(`with scope "${scope}" the date must be in ${month} (only its day of the month is used); use scope "all" to move the start`);
        const eff = fixedFieldsAt(t, month);
        const ch: OccurrenceFields = {};
        if (description !== undefined && description !== eff.description) ch.description = description;
        if (amount !== undefined && amount !== eff.amount) ch.amount = amount;
        if (category !== undefined && category !== (eff.category ?? 'other')) ch.category = category;
        if (date !== undefined && parseISO(date).d !== eff.day) ch.day = parseISO(date).d;
        next = applyFixedChange(next, month, ch, scope === 'this_month' ? 'one' : 'forward');
        const where = scope === 'this_month' ? `only ${month}` : `from ${month} on`;
        if (ch.description !== undefined) mark(`description "${ch.description}" (${where})`);
        if (ch.amount !== undefined) mark(`amount ${fmt(ch.amount, w)} (${where})`);
        if (ch.category !== undefined) mark(`category ${ch.category} (${where})`);
        if (ch.day !== undefined) mark(`day ${ch.day} (${where})`);
      }
      if (confirmed !== undefined) {
        const has = next.confirmedMonths.includes(month);
        if (confirmed && !has) next.confirmedMonths = [...next.confirmedMonths, month];
        if (!confirmed && has) next.confirmedMonths = next.confirmedMonths.filter((m) => m !== month);
        mark(`${confirmed ? 'confirmed' : 'not confirmed'} for ${month}`);
      }
      docs.push(dropEmpty(next));
    } else {
      const group = t.installment?.groupId;
      const members = group ? w.txs.filter((x) => x.installment?.groupId === group && !x.archivedAt).sort((x, y) => (x.installment?.index ?? 0) - (y.installment?.index ?? 0)) : [t];
      // whole group: description, category, card
      let invoiceBase: string | undefined;
      if (cardChanged && card) {
        const first = members[0] as Tx;
        invoiceBase = first.invoiceKey && first.cardId ? first.invoiceKey : addMonthsToKey(openInvoiceKey(card, first.date), 1);
      }
      for (const m of members) {
        const next: Tx = { ...m };
        if (description !== undefined) next.description = description;
        if (category !== undefined) next.category = category;
        if (cardChanged) {
          if (card) {
            next.cardId = card.id;
            next.invoiceKey = m.invoiceKey && m.cardId ? m.invoiceKey : addMonthsToKey(invoiceBase as string, (m.installment?.index ?? 1) - 1);
            next.confirmed = false;
          } else {
            delete next.cardId;
            delete next.invoiceKey;
          }
        }
        if (m.id === t.id) {
          if (amount !== undefined) next.amount = amount;
          if (date !== undefined) next.date = date;
          if (confirmed !== undefined) next.confirmed = confirmed;
        }
        docs.push(next);
      }
      if (description !== undefined) mark(`description "${description}"${group ? ' (whole installment group)' : ''}`);
      if (category !== undefined) mark(`category ${category}${group ? ' (whole group)' : ''}`);
      if (cardChanged) mark(card ? `card ${card.name}${group ? ' (whole group)' : ''}` : `taken off the card${group ? ' (whole group)' : ''}`);
      if (amount !== undefined) mark(`amount ${fmt(amount, w)}${group ? ` (installment ${t.installment?.index} only)` : ''}`);
      if (date !== undefined) mark(`date ${date}${group ? ` (installment ${t.installment?.index} only)` : ''}`);
      if (confirmed !== undefined) mark(confirmed ? 'confirmed' : 'not confirmed');
    }
    await save(ctx, { transactions: docs.map((d) => clean(d)) as unknown as Doc[] });
    return `Updated "${docs.find((d) => d.id === t.id)?.description ?? t.description}": ${changes.length ? changes.join(', ') : 'nothing needed to change'}.`;
  },
);

/** Archives or restores a transaction (an installment group moves together). */
async function setTxArchived(ctx: ToolCtx, idRaw: unknown, archive: boolean): Promise<string> {
  const w = await load(ctx);
  const t = txNamed(w, idRaw);
  const group = t.installment?.groupId;
  const members = group ? w.txs.filter((x) => x.installment?.groupId === group) : [t];
  const target = members.filter((x) => (archive ? !x.archivedAt : !!x.archivedAt));
  if (target.length === 0) return `"${t.description}" is already ${archive ? 'archived' : 'active'}; nothing changed.`;
  const at = Date.now();
  await save(ctx, { transactions: target.map((x) => clean({ ...x, archivedAt: archive ? at : undefined })) as unknown as Doc[] });
  const what = members.length > 1 ? `the ${members.length} installments of "${t.description}"` : `"${t.description}"`;
  return archive ? `Archived ${what} (nothing is deleted; restore_transaction brings it back).` : `Restored ${what}.`;
}

const archiveTransaction = tool('archive_transaction', 'write', 'Archives a transaction (nothing is deleted and it can be restored). An installment group is archived together. Confirm with the person first.', { id: { type: 'string', description: 'The transaction id from search_transactions.' } }, ['id'], (ctx, a) => setTxArchived(ctx, a.id, true));
const restoreTransaction = tool('restore_transaction', 'write', 'Restores an archived transaction (an installment group together). Find the id with search_transactions and archived: true.', { id: { type: 'string', description: 'The id of the archived transaction.' } }, ['id'], (ctx, a) => setTxArchived(ctx, a.id, false));

const confirmTransaction = tool(
  'confirm_transaction',
  'write',
  'Marks a transaction as happened (paid or received), or back to pending. For a monthly (fixed) transaction it is per month. A card purchase is never confirmed; it is paid with the invoice.',
  {
    id: { type: 'string', description: 'The transaction id from search_transactions.' },
    month: { type: 'string', description: 'YYYY-MM, for monthly (fixed) transactions (default the current month).' },
    confirmed: { type: 'boolean', description: 'true (default) to confirm, false to make it pending again.' },
  },
  ['id'],
  async (ctx, a) => {
    const w = await load(ctx);
    const t = txNamed(w, a.id);
    if (t.archivedAt) fail('that transaction is archived; restore it first (restore_transaction)');
    if (a.confirmed !== undefined && typeof a.confirmed !== 'boolean') fail('"confirmed" must be true or false');
    const value = a.confirmed !== false;
    if (t.cardId && value) fail('a card purchase is never confirmed; it is paid with the invoice (pay_invoice)');
    if (!t.fixed && a.month !== undefined) fail('"month" only applies to monthly (fixed) transactions');
    let next: Tx = { ...t };
    let where = '';
    if (t.fixed) {
      const month = monthArg(a, ctx, t);
      const has = t.confirmedMonths.includes(month);
      next.confirmedMonths = value ? (has ? t.confirmedMonths : [...t.confirmedMonths, month]) : t.confirmedMonths.filter((m) => m !== month);
      where = ` for ${month}`;
    } else next = { ...t, confirmed: value };
    await save(ctx, { transactions: [clean(next)] as unknown as Doc[] });
    return `${value ? 'Confirmed' : 'Marked as pending'} "${t.description}"${where}.`;
  },
);

// ------------------------------------------------------------------ cards

function colorArg(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return fail('"color" must be text');
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  const hit = CARD_COLORS.find((c) => norm(c.label) === norm(raw));
  return hit?.value ?? fail(`"color" must be #RRGGBB or one of: ${CARD_COLORS.map((c) => c.label).join(', ')}`);
}
const dueDayArg = (v: unknown): number => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 31 ? (v as number) : fail('"dueDay" must be a whole number from 1 to 31'));
const COLOR_DOC = `A hex color like #8B3FD9 or one of: ${CARD_COLORS.map((c) => c.label).join(', ')}.`;

const addCard = tool(
  'add_card',
  'write',
  'Adds a credit card.',
  {
    name: { type: 'string', description: 'The card name, 1 to 60 characters, unique among the person\'s cards.' },
    limit: { type: 'number', description: 'The total limit, whole units like 5000.' },
    dueDay: { type: 'integer', minimum: 1, maximum: 31, description: 'Day of the month the invoice is due.' },
    color: { type: 'string', description: `Optional. ${COLOR_DOC}` },
  },
  ['name', 'limit', 'dueDay'],
  async (ctx, a) => {
    const w = await load(ctx);
    const name = str(a, 'name', 60) as string;
    if (w.cards.some((c) => !c.archivedAt && norm(c.name) === norm(name))) fail(`there is already a card named "${name}"`);
    const limit = money(a, 'limit', w.digits) as number;
    const dueDay = dueDayArg(a.dueDay);
    const color = colorArg(a.color) ?? (CARD_COLORS.find((x) => !w.cards.some((c) => c.color === x.value)) ?? CARD_COLORS[0]!).value;
    await save(ctx, { cards: [{ id: newId(), name, limit, dueDay, color, createdAt: Date.now() }] });
    return `Added the card "${name}": limit ${fmt(limit, w)} ${w.currency}, due day ${dueDay}.`;
  },
);

const updateCard = tool(
  'update_card',
  'write',
  'Changes a card\'s name, limit, due day or color (its purchases and invoices are kept; changing the due day moves its invoices\' due dates).',
  {
    card: { type: 'string', description: 'The card\'s current name.' },
    name: { type: 'string', description: 'New name.' },
    limit: { type: 'number', description: 'New total limit, whole units.' },
    dueDay: { type: 'integer', minimum: 1, maximum: 31, description: 'New due day.' },
    color: { type: 'string', description: COLOR_DOC },
  },
  ['card'],
  async (ctx, a) => {
    const w = await load(ctx);
    const c = cardNamed(w, a.card, false);
    if ([a.name, a.limit, a.dueDay, a.color].every((v) => v === undefined)) fail('nothing to change: give at least one of name, limit, dueDay, color');
    const next: Card = { ...c };
    const parts: string[] = [];
    const name = str(a, 'name', 60, false);
    if (name !== undefined) {
      if (w.cards.some((x) => x.id !== c.id && !x.archivedAt && norm(x.name) === norm(name))) fail(`there is already a card named "${name}"`);
      next.name = name;
      parts.push(`name "${name}"`);
    }
    const limit = money(a, 'limit', w.digits, false);
    if (limit !== undefined) (next.limit = limit), parts.push(`limit ${fmt(limit, w)} ${w.currency}`);
    if (a.dueDay !== undefined) (next.dueDay = dueDayArg(a.dueDay)), parts.push(`due day ${next.dueDay}`);
    const color = colorArg(a.color);
    if (color) (next.color = color), parts.push(`color ${color}`);
    await save(ctx, { cards: [clean(next)] as unknown as Doc[] });
    return `Updated the card "${c.name}": ${parts.join(', ')}.`;
  },
);

const archiveCard = tool('archive_card', 'write', 'Archives a card: it stops being offered, but its history (purchases, installments, invoices, payments) stays and still counts. It can be restored.', { card: { type: 'string', description: 'The card name.' } }, ['card'], async (ctx, a) => {
  const w = await load(ctx);
  const c = cardNamed(w, a.card, false);
  await save(ctx, { cards: [clean({ ...c, archivedAt: Date.now() })] as unknown as Doc[] });
  return `Archived the card "${c.name}". Its history is kept; restore_card brings it back.`;
});
const restoreCard = tool('restore_card', 'write', 'Restores an archived card.', { card: { type: 'string', description: 'The archived card\'s name.' } }, ['card'], async (ctx, a) => {
  const w = await load(ctx);
  const c = cardNamed(w, a.card, true);
  if (w.cards.some((x) => !x.archivedAt && norm(x.name) === norm(c.name))) fail(`there is already an active card named "${c.name}"; rename it first`);
  await save(ctx, { cards: [clean({ ...c, archivedAt: undefined })] as unknown as Doc[] });
  return `Restored the card "${c.name}".`;
});

// ------------------------------------------------------------------ categories

const IMPACT_DOC = 'essential (0.1), regular (0.45) or discretionary (0.9): how much spending here counts against financial health. Expenses only.';
const impactArg = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' && v in IMPACT_LEVELS ? IMPACT_LEVELS[v as keyof typeof IMPACT_LEVELS] : fail('"impact" must be essential, regular or discretionary');
};
const toneArg = (v: unknown): Tone | undefined => {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' && (TONE_LIST as string[]).includes(v) ? (v as Tone) : fail(`"tone" must be one of ${TONE_LIST.join(', ')}`);
};
const kindArg = (v: unknown, required: boolean): 'expense' | 'income' | undefined => (v === undefined || v === null ? (required ? fail('"kind" must be "expense" or "income"') : undefined) : v === 'expense' || v === 'income' ? v : fail('"kind" must be "expense" or "income"'));
const baseName = (kind: 'expense' | 'income', slug: string) => (kind === 'expense' ? BUILTIN_EXPENSE : BUILTIN_INCOME).find((b) => b.slug === slug);

/** The stored record of a category; a built-in one without a record yet gets one (id `${kind}_${slug}`, English base name). */
function recordOf(c: CategoryView): CategoryRecord {
  if (c.record) return { ...c.record };
  const b = baseName(c.kind, c.slug);
  return { id: builtinRecordId(c.kind, c.slug), slug: c.slug, kind: c.kind, name: b?.name ?? c.name, ...(c.kind === 'expense' ? { weight: c.weight } : {}), createdAt: Date.now() };
}

const addCategory = tool(
  'add_category',
  'write',
  'Adds a category of the person\'s own.',
  {
    kind: { ...kindOption, description: 'expense or income.' },
    name: { type: 'string', description: 'The category name, 1 to 40 characters.' },
    impact: { type: 'string', enum: Object.keys(IMPACT_LEVELS), description: `${IMPACT_DOC} Default regular.` },
    tone: { type: 'string', enum: TONE_LIST, description: 'How it counts for financial health (expenses only); by default the one the impact suggests.' },
  },
  ['kind', 'name'],
  async (ctx, a) => {
    const w = await load(ctx);
    const kind = kindArg(a.kind, true) as 'expense' | 'income';
    const name = str(a, 'name', 40) as string;
    if (categoryViews(w.records).some((c) => c.kind === kind && !c.archived && norm(c.name) === norm(name))) fail(`there is already a ${kind} category named "${name}"`);
    const weight = impactArg(a.impact);
    const tone = toneArg(a.tone);
    if (kind === 'income' && (weight !== undefined || tone !== undefined)) fail('impact and tone only apply to expense categories');
    const id = newId();
    const w2 = weight ?? IMPACT_LEVELS.regular;
    const rec: Doc = clean({ id, slug: id, kind, name, weight: kind === 'expense' ? w2 : undefined, tone: kind === 'expense' ? tone ?? toneFromWeight(w2) : undefined, createdAt: Date.now() });
    await save(ctx, { categories: [rec] });
    return `Added the ${kind} category "${name}".`;
  },
);

const updateCategory = tool(
  'update_category',
  'write',
  'Renames a category or changes its impact/tone (works on built-in ones too).',
  {
    category: { type: 'string', description: 'The category\'s current name or slug.' },
    kind: { ...kindOption, description: 'Only to tell apart a name that exists as both expense and income (like Refund). It cannot change the category\'s kind.' },
    name: { type: 'string', description: 'New name, 1 to 40 characters.' },
    impact: { type: 'string', enum: Object.keys(IMPACT_LEVELS), description: IMPACT_DOC },
    tone: { type: 'string', enum: TONE_LIST, description: 'Expenses only.' },
  },
  ['category'],
  async (ctx, a) => {
    const w = await load(ctx);
    const c = categoryNamed(w, a.category, kindArg(a.kind, false), false);
    const name = str(a, 'name', 40, false);
    const weight = impactArg(a.impact);
    const tone = toneArg(a.tone);
    if (name === undefined && weight === undefined && tone === undefined) fail('nothing to change: give at least one of name, impact, tone');
    if (c.kind === 'income' && (weight !== undefined || tone !== undefined)) fail('impact and tone only apply to expense categories');
    if (name !== undefined && categoryViews(w.records).some((x) => x.kind === c.kind && !x.archived && !(x.slug === c.slug) && norm(x.name) === norm(name))) fail(`there is already a ${c.kind} category named "${name}"`);
    const rec = recordOf(c);
    if (name !== undefined) rec.name = name;
    if (weight !== undefined) rec.weight = weight;
    if (tone !== undefined) rec.tone = tone;
    await save(ctx, { categories: [clean(rec)] as unknown as Doc[] });
    const parts = [name !== undefined ? `name "${name}"` : '', a.impact ? `impact ${String(a.impact)}` : '', tone ? `tone ${tone}` : ''].filter(Boolean);
    return `Updated the ${c.kind} category "${c.name}": ${parts.join(', ')}.`;
  },
);

async function setCategoryArchived(ctx: ToolCtx, a: Record<string, unknown>, archive: boolean): Promise<string> {
  const w = await load(ctx);
  const c = categoryNamed(w, a.category, kindArg(a.kind, false), !archive);
  if (archive && c.system) fail(`"${c.name}" is a system category (the app relies on it); it can be renamed but not archived`);
  const rec = recordOf(c);
  if (archive) rec.archivedAt = Date.now();
  else delete rec.archivedAt;
  await save(ctx, { categories: [clean(rec)] as unknown as Doc[] });
  return archive ? `Archived the ${c.kind} category "${c.name}". Old transactions keep it; restore_category brings it back.` : `Restored the ${c.kind} category "${c.name}".`;
}
const catProps = { category: { type: 'string', description: 'The category name or slug.' }, kind: { ...kindOption, description: 'Only to tell apart a name that exists as both expense and income.' } };
const archiveCategory = tool('archive_category', 'write', 'Archives a category: it is no longer offered for new transactions, old ones keep it. The system categories (Loan, Refund, Other) cannot be archived.', catProps, ['category'], (ctx, a) => setCategoryArchived(ctx, a, true));
const restoreCategory = tool('restore_category', 'write', 'Restores an archived category.', catProps, ['category'], (ctx, a) => setCategoryArchived(ctx, a, false));

// ------------------------------------------------------------------ invoices

function invoiceKeyArg(card: Card, raw: unknown, today: string): string {
  if (raw === 'open') return openInvoiceKey(card, today);
  if (!isMonthKey(raw)) return fail('"invoice" must be "open" (the invoice open today) or a due month like 2026-12');
  return raw;
}

const payInvoice = tool(
  'pay_invoice',
  'write',
  'Records a payment of a credit card invoice (it leaves the account balance on that date). A partial payment is fine.',
  {
    card: { type: 'string', description: 'The card name.' },
    invoice: { type: 'string', description: '"open" (the invoice open today) or its due month, YYYY-MM (see list_invoices).' },
    amount: { type: 'number', description: 'The amount paid, positive, whole units like 350.00.' },
    date: { type: 'string', description: 'YYYY-MM-DD the payment was made (default today).' },
  },
  ['card', 'invoice', 'amount'],
  async (ctx, a) => {
    const w = await load(ctx);
    const card = activeCard(w, a.card);
    const key = invoiceKeyArg(card, a.invoice, ctx.today);
    const amount = money(a, 'amount', w.digits) as number;
    const date = optDate(a, 'date', ctx.today) ?? ctx.today;
    const before = findInvoice(invoicesNow(w.txs, w.cards, w.payments, ctx.today), card, key);
    await save(ctx, { payments: [{ id: newId(), cardId: card.id, invoiceKey: key, amount, date }] });
    const left = Math.max(before.total - before.paid - amount, 0);
    const over = amount > remaining(before) ? ' (that is more than what was left on it)' : '';
    return `Recorded a payment of ${fmt(amount, w)} ${w.currency} on ${card.name}, invoice ${key}, dated ${date}${over}. Remaining on that invoice: ${fmt(left, w)}.`;
  },
);

const archivePayment = tool('archive_payment', 'write', 'Archives an invoice payment (nothing is deleted; restore_payment brings it back). Ids come from list_payments.', { id: { type: 'string', description: 'The payment id from list_payments.' } }, ['id'], async (ctx, a) => {
  const w = await load(ctx);
  const p = (typeof a.id === 'string' ? w.payments.find((x) => x.id === a.id) : undefined) ?? fail('no payment with that id. Use list_payments.');
  if ((p as Payment).archivedAt) return 'That payment is already archived; nothing changed.';
  await save(ctx, { payments: [clean({ ...(p as Payment), archivedAt: Date.now() })] as unknown as Doc[] });
  return `Archived the payment of ${fmt((p as Payment).amount, w)} ${w.currency} on ${cardName(w, (p as Payment).cardId) ?? 'a card'}, invoice ${(p as Payment).invoiceKey}.`;
});
const restorePayment = tool('restore_payment', 'write', 'Restores an archived invoice payment (ids from list_payments with archived: true).', { id: { type: 'string', description: 'The archived payment id.' } }, ['id'], async (ctx, a) => {
  const w = await load(ctx);
  const p = (typeof a.id === 'string' ? w.payments.find((x) => x.id === a.id) : undefined) ?? fail('no payment with that id. Use list_payments with archived: true.');
  if (!(p as Payment).archivedAt) return 'That payment is already active; nothing changed.';
  await save(ctx, { payments: [clean({ ...(p as Payment), archivedAt: undefined })] as unknown as Doc[] });
  return `Restored the payment of ${fmt((p as Payment).amount, w)} ${w.currency}, invoice ${(p as Payment).invoiceKey}.`;
});

const adjustInvoice = tool(
  'adjust_invoice',
  'write',
  'Makes an invoice total match what the bank says: the difference is added as an "Invoice adjustment" charge (if the bank shows more) or credit (if less), pending, on that card and invoice.',
  {
    card: { type: 'string', description: 'The card name.' },
    invoice: { type: 'string', description: '"open" or the due month YYYY-MM.' },
    newTotal: { type: 'number', description: 'The invoice total as the bank shows it, whole units (0 or more).' },
  },
  ['card', 'invoice', 'newTotal'],
  async (ctx, a) => {
    const w = await load(ctx);
    const card = activeCard(w, a.card);
    const key = invoiceKeyArg(card, a.invoice, ctx.today);
    if (typeof a.newTotal !== 'number' || !Number.isFinite(a.newTotal) || a.newTotal < 0) fail('"newTotal" must be a number of 0 or more, in whole units');
    const target = Math.round((a.newTotal as number) * 10 ** w.digits);
    if (target > MAX_MINOR) fail('"newTotal" is out of range');
    const current = findInvoice(invoicesNow(w.txs, w.cards, w.payments, ctx.today), card, key);
    const diff = target - current.total;
    if (diff === 0) return `The ${card.name} invoice ${key} already totals ${fmt(current.total, w)} ${w.currency}; nothing to adjust.`;
    const doc: Doc = {
      id: newId(),
      type: diff > 0 ? 'expense' : 'income',
      description: 'Invoice adjustment',
      amount: Math.abs(diff),
      date: ctx.today,
      confirmed: false,
      fixed: false,
      confirmedMonths: [],
      cardId: card.id,
      invoiceKey: key,
      ...(diff > 0 ? { category: 'other' } : {}),
      createdAt: Date.now(),
    };
    // the app files an adjustment credit under Refund too (income on a card), so keep it identical
    if (diff < 0) doc.category = 'refund';
    await save(ctx, { transactions: [doc] });
    return `Adjusted the ${card.name} invoice ${key} from ${fmt(current.total, w)} to ${fmt(target, w)} ${w.currency}: added an adjustment ${diff > 0 ? 'charge' : 'credit'} of ${fmt(Math.abs(diff), w)}.`;
  },
);

// ------------------------------------------------------------------ preferences

const setPreferences = tool(
  'set_preferences',
  'write',
  'Changes the person\'s language and/or currency (what the app shows). Stored amounts do not change; only the unit they are shown in. Confirm with the person first.',
  {
    language: { type: 'string', enum: [...LANGUAGES], description: 'App language.' },
    currency: { type: 'string', description: 'A 3-letter ISO currency code, like USD, EUR, BRL.' },
  },
  [],
  async (ctx, a) => {
    if (a.language === undefined && a.currency === undefined) fail('nothing to change: give a language and/or a currency');
    if (a.language !== undefined && !(LANGUAGES as readonly string[]).includes(a.language as string)) fail(`"language" must be one of ${LANGUAGES.join(', ')}`);
    let currency: string | undefined;
    if (a.currency !== undefined) {
      currency = typeof a.currency === 'string' ? a.currency.trim().toUpperCase() : '';
      const known = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency');
      if (!/^[A-Z]{3}$/.test(currency) || (known && !known.includes(currency))) fail('"currency" must be a 3 letter ISO code like USD, EUR or BRL');
    }
    const cur = await ctx.pool.query('select language, currency from settings where user_id = $1', [ctx.userId]);
    const language = (a.language as string | undefined) ?? (cur.rows[0]?.language as string | undefined) ?? 'en';
    const cc = currency ?? (cur.rows[0]?.currency as string | undefined) ?? 'USD';
    await ctx.pool.query(
      `insert into settings (user_id, language, currency) values ($1, $2, $3)
       on conflict (user_id) do update set language = excluded.language, currency = excluded.currency, updated_at = now()`,
      [ctx.userId, language, cc],
    );
    return `Preferences saved: language ${language}, currency ${cc}.`;
  },
);

/** Changes to the person's own finances beyond adding a transaction. */
export const dataTools: McpTool[] = [
  searchTransactions, listInvoices, listPayments,
  updateTransaction, archiveTransaction, restoreTransaction, confirmTransaction,
  addCard, updateCard, archiveCard, restoreCard,
  addCategory, updateCategory, archiveCategory, restoreCategory,
  payInvoice, archivePayment, restorePayment, adjustInvoice, setPreferences,
];
