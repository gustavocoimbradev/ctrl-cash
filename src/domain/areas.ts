import { AppData, Occurrence, Transaction } from '../types';
import { buildInvoices } from './invoices';
import { addMonthsToKey, currentMonthKey, monthKey, parseISO } from './dates';
import { buildOccurrences, fixedFieldsAt, monthOccurrences, monthTotals } from './transactions';

/**
 * The focus areas (subscriptions, utility bills, delivery): each looks at ONE category of spending and tells the person
 * what it costs them, in their own numbers. The transaction list still shows everything in a generic way.
 */
export type AreaKey = 'subscriptions' | 'bills' | 'delivery';

export const AREA_CATEGORY: Record<AreaKey, string> = { subscriptions: 'subscriptions', bills: 'bills', delivery: 'delivery' };

export interface AreaItem {
  key: string;
  transaction: Transaction;
  /** the month the occurrence belongs to (to edit a fixed one) */
  month: string;
  description: string;
  amount: number;
  /** day of the month it falls on (fixed ones) or the date of the order (delivery) */
  day: number;
  date: string;
  cardId?: string;
  /** a fixed one confirmed (paid) this month */
  paid: boolean;
}

export interface AreaSummary {
  items: AreaItem[];
  /** what it costs a month: the sum of the fixed items, or the average of the last 3 months for one-off spending */
  monthly: number;
  yearly: number;
  /** average monthly income of the last 3 months that had income; 0 when unknown */
  income: number;
  /** monthly / income, 0 when income is unknown */
  share: number;
  /** fixed items: how much of them is already paid this month */
  paidThisMonth: number;
  orders: number;
  biggest: AreaItem | null;
  /** the fixed item due next (by day of month) that is not paid yet */
  next: AreaItem | null;
}

/** Average monthly income of the last 3 months that had income (0 when unknown): the base of "how much of my income is this". */
function recentIncome(occ: Occurrence[], invoices: ReturnType<typeof buildInvoices>): number {
  const cur = currentMonthKey();
  const incomes: number[] = [];
  for (let k = 0; k < 3; k++) {
    const key = addMonthsToKey(cur, -k);
    const inc = monthTotals(monthOccurrences(occ, key).filter((o) => !o.cardId), invoices.filter((i) => monthKey(i.dueDate) === key)).income;
    if (inc > 0) incomes.push(inc);
  }
  return incomes.length ? Math.round(incomes.reduce((a, b) => a + b, 0) / incomes.length) : 0;
}

export function areaSummary(data: AppData, area: AreaKey): AreaSummary {
  const cur = currentMonthKey();
  const slug = AREA_CATEGORY[area];
  const occ = buildOccurrences(data, cur);
  const invoices = buildInvoices(data, occ);
  const txById = new Map(data.transactions.map((x) => [x.id, x]));

  const income = recentIncome(occ, invoices);

  let items: AreaItem[];
  let monthly: number;
  let orders = 0;
  if (area === 'delivery') {
    // one-off spending: every order of the last 3 months (by purchase date), newest first
    const recent = new Set([0, 1, 2].map((k) => addMonthsToKey(cur, -k)));
    const list = occ.filter((o) => o.type === 'expense' && o.category === slug && recent.has(monthKey(o.purchaseDate)));
    items = list
      .map((o: Occurrence) => ({ o, tx: txById.get(o.transactionId) }))
      .filter((x): x is { o: Occurrence; tx: Transaction } => !!x.tx)
      .map(({ o, tx }) => ({ key: o.key, transaction: tx, month: o.monthKey, description: o.description, amount: o.amount, day: parseISO(o.purchaseDate).d, date: o.purchaseDate, cardId: o.cardId, paid: o.confirmed }))
      .sort((a, b) => b.date.localeCompare(a.date));
    orders = items.length;
    monthly = Math.round(items.reduce((s, x) => s + x.amount, 0) / 3);
  } else {
    // fixed charges: what repeats every month, with the values of this month
    items = data.transactions
      .filter((x) => x.fixed && x.type === 'expense' && !x.archivedAt && (fixedFieldsAt(x, cur).category ?? x.category) === slug)
      .map((tx) => {
        const f = fixedFieldsAt(tx, cur);
        return { key: tx.id, transaction: tx, month: cur, description: f.description, amount: f.amount, day: f.day, date: tx.date, cardId: tx.cardId, paid: !tx.cardId && tx.confirmedMonths.includes(cur) };
      })
      .sort((a, b) => a.day - b.day || a.description.localeCompare(b.description));
    monthly = items.reduce((s, x) => s + x.amount, 0);
  }

  const today = new Date().getDate();
  const unpaid = items.filter((x) => !x.paid && !x.cardId);
  const next = area === 'delivery' ? null : unpaid.find((x) => x.day >= today) ?? unpaid[0] ?? null;
  return {
    items,
    monthly,
    yearly: monthly * 12,
    income,
    share: income > 0 ? monthly / income : 0,
    paidThisMonth: items.filter((x) => x.paid).reduce((s, x) => s + x.amount, 0),
    orders,
    biggest: items.length ? items.reduce((a, b) => (b.amount > a.amount ? b : a)) : null,
    next,
  };
}

/** One purchase paid in installments (on a card or not): what is left of it. */
export interface DebtItem {
  groupId: string;
  /** the transaction of the next installment, to open it for editing */
  transaction: Transaction;
  month: string;
  description: string;
  cardId?: string;
  /** installments still to pay, of `total` */
  left: number;
  total: number;
  /** what the next installment costs */
  next: number;
  /** what is still to pay in all */
  remaining: number;
  /** month (YYYY-MM) of the last installment */
  endsAt: string;
}

export interface DebtsSummary {
  items: DebtItem[];
  /** everything still to pay in installments */
  owed: number;
  /** what falls due this month */
  thisMonth: number;
  income: number;
  /** thisMonth / income, 0 when income is unknown */
  share: number;
}

/**
 * Debts: everything bought in installments, on a card or not, that still has installments to pay. An installment is still
 * to pay when it falls in this month or later, or when it is an earlier one on the account not yet confirmed.
 */
export function debtsSummary(data: AppData): DebtsSummary {
  const cur = currentMonthKey();
  const occ = buildOccurrences(data, addMonthsToKey(cur, 60));
  const invoices = buildInvoices(data, occ);
  const txById = new Map(data.transactions.map((x) => [x.id, x]));
  const groups = new Map<string, Occurrence[]>();
  for (const o of occ) {
    if (!o.installment || o.type !== 'expense') continue;
    const list = groups.get(o.installment.groupId) ?? [];
    list.push(o);
    groups.set(o.installment.groupId, list);
  }
  const items: DebtItem[] = [];
  let thisMonth = 0;
  for (const [groupId, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const left = sorted.filter((o) => monthKey(o.date) >= cur || (!o.cardId && !o.confirmed));
    if (left.length === 0) continue;
    const first = left[0];
    const tx = txById.get(first.transactionId);
    if (!tx) continue;
    items.push({
      groupId,
      transaction: tx,
      month: first.monthKey,
      description: first.description,
      cardId: first.cardId,
      left: left.length,
      total: first.installment!.total,
      next: first.amount,
      remaining: left.reduce((s, o) => s + o.amount, 0),
      endsAt: monthKey(sorted[sorted.length - 1].date),
    });
    thisMonth += sorted.filter((o) => monthKey(o.date) === cur).reduce((s, o) => s + o.amount, 0);
  }
  items.sort((a, b) => a.endsAt.localeCompare(b.endsAt) || a.description.localeCompare(b.description));
  const income = recentIncome(occ, invoices);
  return { items, owed: items.reduce((s, x) => s + x.remaining, 0), thisMonth, income, share: income > 0 ? thisMonth / income : 0 };
}
