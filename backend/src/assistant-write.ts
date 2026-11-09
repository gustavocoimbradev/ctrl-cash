// What a connected assistant may add on the person's behalf (only when they allowed it): transactions, made the way the app
// makes them (installments split into independent transactions, a card purchase on its invoice). It never edits or removes.
import { randomBytes } from 'node:crypto';
import type { Pool } from './db.js';
import { upsertDocs, withTransaction } from './db.js';
import { validate, ValidationError, type Doc } from './validate.js';

/** The built-in categories (the app keeps their names; a person may add their own). */
export const EXPENSE_CATEGORIES: Record<string, string> = {
  groceries: 'Groceries', butcher: 'Butcher', bills: 'Bills', health: 'Health', taxes: 'Taxes', bureaucracy: 'Paperwork', education: 'Education',
  investments: 'Investments', refund: 'Refund', loan: 'Loan', car: 'Car', pets: 'Pets', personal_care: 'Personal care', subscriptions: 'Subscriptions',
  delivery: 'Delivery', debts: 'Debts', gifts: 'Gifts', leisure: 'Leisure', other: 'Other',
};
export const INCOME_CATEGORIES: Record<string, string> = { salary: 'Salary', freelance: 'Freelance', refund: 'Refund' };

const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthKeyOf = (iso: string) => iso.slice(0, 7);
function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
function addMonths(iso: string, n: number): string {
  const [, , d] = iso.split('-').map(Number) as [number, number, number];
  const [y, m] = addMonthsToKey(monthKeyOf(iso), n).split('-').map(Number) as [number, number];
  return toISO(y, m, Math.min(d, daysIn(y, m)));
}
const newId = () => Date.now().toString(36) + randomBytes(4).toString('hex');

/** Decimal places of a currency (2 for dollars, 0 for yen, 3 for dinars): the amounts are stored in the smallest unit. */
export const digitsOf = (currency: string): number => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};

export interface AddArgs {
  type?: unknown;
  description?: unknown;
  amount?: unknown;
  date?: unknown;
  category?: unknown;
  confirmed?: unknown;
  card?: unknown;
  installments?: unknown;
  fixed?: unknown;
  invoice?: unknown;
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Creates what was asked, validated by the same rules as the app's own writes. Returns a short text for the assistant. */
export async function addTransactions(pool: Pool, userId: string, args: AddArgs, today: string): Promise<string> {
  const fail = (m: string): never => {
    throw new ValidationError(m);
  };
  const type = args.type === 'income' || args.type === 'expense' ? args.type : fail('"type" must be "expense" or "income"');
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (!description || [...description].length > 100) fail('"description" must be 1 to 100 characters');

  const settings = await pool.query('select currency from settings where user_id = $1', [userId]);
  const currency = (settings.rows[0]?.currency as string | undefined) ?? 'USD';
  const digits = digitsOf(currency);
  if (typeof args.amount !== 'number' || !Number.isFinite(args.amount) || args.amount <= 0) fail('"amount" must be a positive number in whole units of the currency, like 49.90');
  const amount = Math.round((args.amount as number) * 10 ** digits);
  if (amount <= 0 || amount > 100_000_000_000) fail('"amount" is out of range');

  const date = args.date === undefined ? today : typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : fail('"date" must be YYYY-MM-DD');
  // a typo like 2062 must not create a transaction decades away
  const yearsAway = Math.abs(Number(date.slice(0, 4)) - Number(today.slice(0, 4)));
  if (yearsAway > 2) fail('"date" is more than two years from today');

  // category: a slug, a name (the built-in English one or the person's own), or nothing (Other for expenses)
  const rows = await pool.query('select id, slug, kind, name, archived_at_ms from categories where user_id = $1', [userId]);
  const mine = rows.rows.filter((r) => r.kind === type && r.archived_at_ms === null);
  const builtin = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  let category: string | undefined;
  const raw = typeof args.category === 'string' ? args.category : undefined;
  if (raw) {
    const n = norm(raw);
    category =
      mine.find((r) => norm(r.slug) === n || norm(r.name) === n)?.slug ??
      Object.entries(builtin).find(([slug, name]) => slug === n || norm(name) === n)?.[0];
    if (!category) fail(`unknown category "${raw}". Use one of: ${[...Object.keys(builtin), ...mine.filter((r) => !(r.slug in builtin)).map((r) => r.name)].join(', ')}`);
    // a built-in category the person archived is not offered
    if (rows.rows.some((r) => r.kind === type && r.archived_at_ms !== null && r.slug === category)) fail(`the category "${raw}" is archived`);
  } else if (type === 'expense') category = 'other';
  else fail('income needs a "category" (salary, freelance or refund, or one of the person\'s own)');

  // card: by name; a card purchase is never confirmed (it is paid with the invoice)
  let cardId: string | undefined;
  let dueDay = 1;
  if (args.card !== undefined && args.card !== null && args.card !== '') {
    const cards = await pool.query('select id, name, due_day from cards where user_id = $1 and archived_at_ms is null', [userId]);
    const n = norm(String(args.card));
    const found = cards.rows.find((r) => norm(r.name) === n) ?? cards.rows.find((r) => norm(r.name).includes(n));
    if (!found) fail(`unknown card "${String(args.card)}". Cards: ${cards.rows.map((r) => r.name).join(', ') || 'none registered'}`);
    cardId = found.id as string;
    dueDay = Number(found.due_day);
  }

  const installments = args.installments === undefined ? 1 : Number.isInteger(args.installments) && (args.installments as number) >= 1 && (args.installments as number) <= 48 ? (args.installments as number) : fail('"installments" must be a whole number from 1 to 48');
  const fixed = args.fixed === true;
  if (fixed && installments > 1) fail('a monthly (fixed) transaction cannot also be in installments');
  const confirmed = cardId ? false : args.confirmed === undefined ? true : args.confirmed === true;
  if (type === 'income' && cardId) fail('income cannot go on a card');

  // the invoice of a card purchase: the next one by default (where purchases usually land), or the one open on the date
  let invoiceKey: string | undefined;
  if (cardId) {
    const open = Number(date.slice(8, 10)) <= dueDay ? monthKeyOf(date) : addMonthsToKey(monthKeyOf(date), 1);
    invoiceKey = args.invoice === 'open' ? open : addMonthsToKey(open, 1);
  }

  const now = Date.now();
  const base = { type, fixed, confirmedMonths: fixed && confirmed ? [monthKeyOf(date)] : [], ...(cardId ? { cardId } : {}), ...(category ? { category } : {}) };
  const docs: Doc[] = [];
  if (fixed || installments <= 1) {
    docs.push({ ...base, id: newId(), description, amount, date, confirmed, ...(invoiceKey ? { invoiceKey } : {}), createdAt: now, source: 'claude' });
  } else {
    const groupId = newId();
    const each = Math.floor(amount / installments);
    const remainder = amount - each * installments;
    for (let i = 0; i < installments; i++) {
      docs.push({
        ...base,
        id: newId(),
        description,
        amount: i === 0 ? each + remainder : each,
        date: addMonths(date, i),
        confirmed: i === 0 ? confirmed : false,
        ...(invoiceKey ? { invoiceKey: addMonthsToKey(invoiceKey, i) } : {}),
        createdAt: now + i,
        source: 'claude',
        installment: { index: i + 1, total: installments, groupId },
      });
    }
  }
  for (const d of docs) {
    const message = validate('transactions', d);
    if (message) fail(message);
  }
  await withTransaction(pool, (client) => upsertDocs(client, userId, { transactions: docs }));

  const where = cardId ? ` on the card, invoice ${invoiceKey}` : confirmed ? ' (already paid/received)' : ' (pending)';
  const what = fixed ? 'a monthly transaction' : installments > 1 ? `${installments} installments` : 'a transaction';
  return `Added ${what}: ${type} "${description}", ${args.amount} ${currency}, ${date}, category ${category}${where}. It shows in the app within a few seconds.`;
}
