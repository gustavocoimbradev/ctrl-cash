// The pure finance logic of the app (src/domain/*), copied for the server so a connected assistant works with exactly the same
// numbers as the website: dates, how a monthly (fixed) transaction becomes one occurrence per month with its revisions and
// overrides, and how card purchases are grouped into invoices. No i18n, no UI. Amounts are integers in the currency's smallest unit.

export interface Installment {
  index: number;
  total: number;
  groupId: string;
}
export interface OccurrenceFields {
  description?: string;
  amount?: number;
  category?: string;
  /** day of the month (1-31) */
  day?: number;
}
export interface Revision extends OccurrenceFields {
  from: string;
}
export interface Tx {
  id: string;
  type: 'income' | 'expense';
  description: string;
  amount: number;
  date: string;
  confirmed: boolean;
  fixed: boolean;
  confirmedMonths: string[];
  cardId?: string;
  reserveId?: string;
  invoiceKey?: string;
  category?: string;
  installment?: Installment;
  createdAt?: number;
  revisions?: Revision[];
  overrides?: Record<string, OccurrenceFields>;
  archivedAt?: number;
}
export interface Card {
  id: string;
  name: string;
  limit: number;
  dueDay: number;
  color?: string;
  createdAt?: number;
  archivedAt?: number;
}
export interface Payment {
  id: string;
  cardId: string;
  invoiceKey: string;
  amount: number;
  date: string;
  archivedAt?: number;
}
export interface Occurrence {
  key: string;
  transactionId: string;
  type: 'income' | 'expense';
  description: string;
  amount: number;
  /** effective date (the invoice due date for card purchases) */
  date: string;
  purchaseDate: string;
  confirmed: boolean;
  fixed: boolean;
  cardId?: string;
  category?: string;
  installment?: Installment;
  invoiceKey?: string;
  order: number;
  /** YYYY-MM the occurrence belongs to (used to confirm fixed ones) */
  monthKey: string;
}

// ---- dates ----
export const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const parseISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d };
};
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthKey = (iso: string) => iso.slice(0, 7);
export function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
/** Adds months keeping the day, clamped to the last day of the month. */
export function addMonths(iso: string, n: number): string {
  const { d } = parseISO(iso);
  const [y, m] = addMonthsToKey(monthKey(iso), n).split('-').map(Number) as [number, number];
  return toISO(y, m, Math.min(d, daysInMonth(y, m)));
}
export const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
export const isMonthKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

// ---- cards ----
/** The invoice open on a date: the one that receives purchases made then (this month up to the due day, then the next). */
export function openInvoiceKey(card: Pick<Card, 'dueDay'>, iso: string): string {
  const key = monthKey(iso);
  return parseISO(iso).d <= card.dueDay ? key : addMonthsToKey(key, 1);
}
export function dueDateFor(card: Pick<Card, 'dueDay'>, key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return toISO(y, m, Math.min(card.dueDay, daysInMonth(y, m)));
}
/** The colors offered for a card. */
export const CARD_COLORS: { label: string; value: string }[] = [
  { label: 'Purple', value: '#8B3FD9' },
  { label: 'Blue', value: '#2F80ED' },
  { label: 'Sky', value: '#0EA5E9' },
  { label: 'Coral', value: '#E0446A' },
  { label: 'Orange', value: '#F08A5D' },
  { label: 'Yellow', value: '#F2B544' },
  { label: 'Pink', value: '#E056A0' },
  { label: 'Gray', value: '#64748B' },
];

// ---- occurrences ----
export function fixedFieldsAt(tx: Tx, mKey: string): { description: string; amount: number; category?: string; day: number } {
  const out: { description: string; amount: number; category?: string; day: number } = {
    description: tx.description,
    amount: tx.amount,
    ...(tx.category !== undefined ? { category: tx.category } : {}),
    day: parseISO(tx.date).d,
  };
  const apply = (f: OccurrenceFields) => {
    if (f.description !== undefined) out.description = f.description;
    if (f.amount !== undefined) out.amount = f.amount;
    if (f.category !== undefined) out.category = f.category;
    if (f.day !== undefined) out.day = f.day;
  };
  [...(tx.revisions ?? [])].sort((a, b) => a.from.localeCompare(b.from)).filter((r) => r.from <= mKey).forEach(apply);
  if (tx.overrides?.[mKey]) apply(tx.overrides[mKey]);
  return out;
}

export function withDay(iso: string, day: number): string {
  const { y, m } = parseISO(iso);
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

/** One occurrence of every non-fixed transaction, and one per month (up to `untilMonthKey`) of every fixed one. */
export function buildOccurrences(transactions: Tx[], cards: Card[], untilMonthKey: string): Occurrence[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: Occurrence[] = [];
  const make = (tx: Tx, purchase: string, mKey: string, order: number, invoiceKey?: string, f?: { description: string; amount: number; category?: string }): Occurrence => {
    const card = tx.cardId ? byId.get(tx.cardId) : undefined;
    return {
      key: tx.fixed ? `${tx.id}@${mKey}` : tx.id,
      transactionId: tx.id,
      type: tx.type,
      description: f?.description ?? tx.description,
      amount: f?.amount ?? tx.amount,
      date: card && invoiceKey ? dueDateFor(card, invoiceKey) : purchase,
      purchaseDate: purchase,
      confirmed: tx.fixed ? tx.confirmedMonths.includes(mKey) : tx.confirmed,
      fixed: tx.fixed,
      ...(tx.cardId ? { cardId: tx.cardId } : {}),
      ...((f ? f.category : tx.category) !== undefined ? { category: (f ? f.category : tx.category) as string } : {}),
      ...(tx.installment ? { installment: tx.installment } : {}),
      ...(invoiceKey ? { invoiceKey } : {}),
      order,
      monthKey: mKey,
    };
  };
  transactions.forEach((tx, order) => {
    if (!tx.fixed) {
      out.push(make(tx, tx.date, monthKey(tx.date), order, tx.invoiceKey));
      return;
    }
    for (let i = 0; addMonthsToKey(monthKey(tx.date), i) <= untilMonthKey; i++) {
      const base = addMonths(tx.date, i);
      const mKey = monthKey(base);
      const f = fixedFieldsAt(tx, mKey);
      out.push(make(tx, withDay(base, f.day), mKey, order, tx.invoiceKey ? addMonthsToKey(tx.invoiceKey, i) : undefined, f));
    }
  });
  return out;
}

// ---- invoices ----
export interface Invoice {
  cardId: string;
  /** due month, YYYY-MM */
  key: string;
  dueDate: string;
  total: number;
  paid: number;
  items: Occurrence[];
  payments: Payment[];
}
/** What is left to pay; never negative (a chargeback larger than the purchases zeroes the invoice). */
export const remaining = (inv: Invoice) => Math.max(inv.total - inv.paid, 0);

/** Groups card occurrences into invoices (by card and due month); income on a card is a chargeback and reduces the total. */
export function buildInvoices(cards: Card[], occurrences: Occurrence[], payments: Payment[]): Invoice[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const map = new Map<string, Invoice>();
  const get = (cardId: string, key: string, dueDate: string) => {
    const id = `${cardId}|${key}`;
    let inv = map.get(id);
    if (!inv) {
      inv = { cardId, key, dueDate, total: 0, paid: 0, items: [], payments: [] };
      map.set(id, inv);
    }
    return inv;
  };
  for (const o of occurrences) {
    if (!o.cardId || !byId.has(o.cardId)) continue;
    const inv = get(o.cardId, monthKey(o.date), o.date);
    inv.items.push(o);
    inv.total += o.type === 'income' ? -o.amount : o.amount;
  }
  for (const p of payments) {
    const card = byId.get(p.cardId);
    if (!card) continue;
    const inv = get(p.cardId, p.invoiceKey, dueDateFor(card, p.invoiceKey));
    inv.payments.push(p);
    inv.paid += p.amount;
  }
  return [...map.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function findInvoice(invoices: Invoice[], card: Card, key: string): Invoice {
  return invoices.find((i) => i.cardId === card.id && i.key === key) ?? { cardId: card.id, key, dueDate: dueDateFor(card, key), total: 0, paid: 0, items: [], payments: [] };
}

/** Invoices the way the app computes them: live (not archived) transactions and payments, fixed ones expanded 3 months ahead. */
export function invoicesNow(transactions: Tx[], cards: Card[], payments: Payment[], today: string): Invoice[] {
  const live = transactions.filter((t) => !t.archivedAt);
  const occ = buildOccurrences(live, cards, addMonthsToKey(monthKey(today), 3));
  return buildInvoices(cards, occ, payments.filter((p) => !p.archivedAt));
}

// ---- categories ----
export type Tone = 'healthy' | 'necessary' | 'comfort' | 'luxury' | 'unhealthy' | 'unknown';
export const TONE_LIST: Tone[] = ['healthy', 'necessary', 'comfort', 'luxury', 'unhealthy', 'unknown'];
export const IMPACT_LEVELS = { essential: 0.1, regular: 0.45, discretionary: 0.9 } as const;
export const toneFromWeight = (weight: number): Tone => (weight <= 0.2 ? 'necessary' : weight <= 0.5 ? 'comfort' : 'luxury');
export const builtinRecordId = (kind: 'expense' | 'income', slug: string) => `${kind}_${slug}`;
/** The category slugs the app logic relies on: they can be renamed but never archived. */
export const SYSTEM_EXPENSE = ['loan', 'refund', 'other'];
export const SYSTEM_INCOME = ['refund'];

export interface BuiltinCategory {
  slug: string;
  name: string;
  weight: number;
  tone?: Tone;
}
export const BUILTIN_EXPENSE: BuiltinCategory[] = [
  { slug: 'groceries', name: 'Groceries', weight: 0.1, tone: 'necessary' },
  { slug: 'butcher', name: 'Butcher', weight: 0.15, tone: 'necessary' },
  { slug: 'bills', name: 'Bills', weight: 0.1, tone: 'necessary' },
  { slug: 'health', name: 'Health', weight: 0.1, tone: 'necessary' },
  { slug: 'taxes', name: 'Taxes', weight: 0.1, tone: 'necessary' },
  { slug: 'bureaucracy', name: 'Paperwork', weight: 0.2, tone: 'necessary' },
  { slug: 'education', name: 'Education', weight: 0.15, tone: 'necessary' },
  { slug: 'investments', name: 'Investments', weight: 0.05, tone: 'healthy' },
  { slug: 'refund', name: 'Refund', weight: 0.2 },
  { slug: 'loan', name: 'Loan', weight: 0 },
  { slug: 'car', name: 'Car', weight: 0.4, tone: 'comfort' },
  { slug: 'pets', name: 'Pets', weight: 0.45, tone: 'comfort' },
  { slug: 'personal_care', name: 'Personal care', weight: 0.5, tone: 'comfort' },
  { slug: 'subscriptions', name: 'Subscriptions', weight: 0.55, tone: 'luxury' },
  { slug: 'delivery', name: 'Delivery', weight: 0.8, tone: 'unhealthy' },
  { slug: 'debts', name: 'Debts', weight: 0.6, tone: 'unhealthy' },
  { slug: 'gifts', name: 'Gifts', weight: 0.7, tone: 'luxury' },
  { slug: 'leisure', name: 'Leisure', weight: 1, tone: 'luxury' },
  { slug: 'other', name: 'Other', weight: 0.6, tone: 'unknown' },
];
export const BUILTIN_INCOME: BuiltinCategory[] = [
  { slug: 'salary', name: 'Salary', weight: 0 },
  { slug: 'freelance', name: 'Freelance', weight: 0 },
  { slug: 'refund', name: 'Refund', weight: 0 },
];

export interface CategoryRecord {
  id: string;
  slug: string;
  kind: 'expense' | 'income';
  name: string;
  weight?: number;
  tone?: Tone;
  createdAt?: number;
  archivedAt?: number;
}
export interface CategoryView {
  slug: string;
  kind: 'expense' | 'income';
  name: string;
  weight: number;
  tone: Tone | null;
  archived: boolean;
  custom: boolean;
  system: boolean;
  /** the stored record, when there is one */
  record?: CategoryRecord;
}

/** Every category (built in and the person's own), with the person's renames and archives applied. */
export function categoryViews(records: CategoryRecord[]): CategoryView[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const builtin = (kind: 'expense' | 'income', list: BuiltinCategory[], system: string[]): CategoryView[] =>
    list.map((b) => {
      const r = byId.get(builtinRecordId(kind, b.slug));
      const isSystem = system.includes(b.slug);
      const weight = r?.weight ?? b.weight;
      return {
        slug: b.slug,
        kind,
        name: r?.name ?? b.name,
        weight,
        tone: kind === 'expense' ? r?.tone ?? b.tone ?? toneFromWeight(weight) : null,
        archived: !!r?.archivedAt && !isSystem,
        custom: false,
        system: isSystem,
        ...(r ? { record: r } : {}),
      };
    });
  const builtinIds = new Set([...BUILTIN_EXPENSE.map((b) => builtinRecordId('expense', b.slug)), ...BUILTIN_INCOME.map((b) => builtinRecordId('income', b.slug))]);
  const custom = records
    .filter((r) => !builtinIds.has(r.id))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map(
      (r): CategoryView => ({
        slug: r.slug,
        kind: r.kind,
        name: r.name,
        weight: r.weight ?? 0.45,
        tone: r.kind === 'expense' ? r.tone ?? toneFromWeight(r.weight ?? 0.45) : null,
        archived: !!r.archivedAt,
        custom: true,
        system: false,
        record: r,
      }),
    );
  return [...builtin('expense', BUILTIN_EXPENSE, SYSTEM_EXPENSE), ...custom.filter((c) => c.kind === 'expense'), ...builtin('income', BUILTIN_INCOME, SYSTEM_INCOME), ...custom.filter((c) => c.kind === 'income')];
}

/** Case- and accent-insensitive form of a name, for matching. */
export const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
