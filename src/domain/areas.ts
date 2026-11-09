import { AppData, Occurrence, Transaction } from '../types';
import { LOAN_CATEGORY } from './categories';
import { buildInvoices, invoiceDebt, remaining } from './invoices';
import { debtTimeline } from './statements';
import { addMonthsToKey, currentMonthKey, monthKey, parseISO, todayISO } from './dates';
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
    // one-off spending: every order there is (by purchase date), newest first; the monthly cost is the average of the last 3 months
    const recent = new Set([0, 1, 2].map((k) => addMonthsToKey(cur, -k)));
    const all = occ.filter((o) => o.type === 'expense' && o.category === slug);
    const list = all;
    items = list
      .map((o: Occurrence) => ({ o, tx: txById.get(o.transactionId) }))
      .filter((x): x is { o: Occurrence; tx: Transaction } => !!x.tx)
      .map(({ o, tx }) => ({ key: o.key, transaction: tx, month: o.monthKey, description: o.description, amount: o.amount, day: parseISO(o.purchaseDate).d, date: o.purchaseDate, cardId: o.cardId, paid: o.confirmed }))
      .sort((a, b) => b.date.localeCompare(a.date));
    orders = items.length;
    monthly = Math.round(all.filter((o) => recent.has(monthKey(o.purchaseDate))).reduce((s, o) => s + o.amount, 0) / 3);
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

/** One thing owed: a purchase on a card (in installments or in one go) or something filed under the Debts category. */
export interface DebtItem {
  key: string;
  /** the transaction to open for editing */
  transaction: Transaction;
  month: string;
  description: string;
  cardId?: string;
  /** installments still to pay, of `total`; both 1 for something paid in one go */
  left: number;
  total: number;
  /** what the next installment (or the whole thing) costs */
  next: number;
  /** what is still to pay in all */
  remaining: number;
  /** month (YYYY-MM) of the last installment */
  endsAt: string;
  /** when the next one falls due */
  dueDate: string;
}

export interface DebtsSummary {
  items: DebtItem[];
  /** everything still owed */
  owed: number;
  /** what falls due this month */
  thisMonth: number;
  income: number;
  /** thisMonth / income, 0 when income is unknown */
  share: number;
}

/**
 * Debts: everything owed. What is on the cards, in installments or in one go, counted by the same rule as the card debt
 * everywhere else (unpaid invoices; what was lent to somebody who pays it back is not mine), and everything filed under the
 * Debts category that is still to pay, by PIX/account or card.
 */
export function debtsSummary(data: AppData): DebtsSummary {
  const cur = currentMonthKey();
  const today = todayISO();
  const occ = buildOccurrences(data, addMonthsToKey(cur, 60));
  const invoices = buildInvoices(data, occ);
  const txById = new Map(data.transactions.map((x) => [x.id, x]));

  const owedOcc: Occurrence[] = [];
  for (const inv of invoices) {
    if (remaining(inv) <= 0) continue;
    owedOcc.push(...invoiceDebt(inv, today).items.filter((o) => o.type === 'expense' && o.category !== LOAN_CATEGORY));
  }
  // filed under Debts, paid from the account: still to pay when not confirmed
  for (const o of occ) {
    if (!o.cardId && o.type === 'expense' && o.category === 'debts' && !o.confirmed && (monthKey(o.date) <= cur || !o.fixed)) owedOcc.push(o);
  }

  const groups = new Map<string, Occurrence[]>();
  for (const o of owedOcc) {
    const key = o.installment?.groupId ?? o.transactionId;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const items: DebtItem[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const tx = txById.get(first.transactionId);
    if (!tx) continue;
    items.push({
      key,
      transaction: tx,
      month: first.monthKey,
      description: first.description,
      cardId: first.cardId,
      left: sorted.length,
      total: first.installment?.total ?? sorted.length,
      next: first.amount,
      remaining: sorted.reduce((sum, o) => sum + o.amount, 0),
      endsAt: monthKey(sorted[sorted.length - 1].date),
      dueDate: first.date,
    });
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description));
  const thisMonth = owedOcc.filter((o) => monthKey(o.date) === cur).reduce((sum, o) => sum + o.amount, 0);
  const income = recentIncome(occ, invoices);
  return { items, owed: items.reduce((sum, x) => sum + x.remaining, 0), thisMonth, income, share: income > 0 ? thisMonth / income : 0 };
}

export interface DebtMonth {
  key: string;
  /** still owed that falls due in this month */
  debt: number;
  /** the part of what fell due in this month that is already paid */
  settled: number;
}

/**
 * How the debts evolve, month by month, from 6 months back to 11 ahead, in one total (no split by card or account): what falls
 * due each month, the paid part apart. The same rule as the card debt chart, plus what is filed under the Debts category on
 * the account. The future shows what is already registered.
 */
export function debtsTimeline(data: AppData): DebtMonth[] {
  const cur = currentMonthKey();
  const today = todayISO();
  const occ = buildOccurrences(data, addMonthsToKey(cur, 12));
  const invoices = buildInvoices(data, occ);
  const cards = data.cards.filter((c) => !c.archivedAt || data.transactions.some((x) => x.cardId === c.id));
  const byCard = debtTimeline(invoices, cards, today);
  const out: DebtMonth[] = [];
  for (let i = -6; i <= 11; i++) {
    const key = addMonthsToKey(cur, i);
    let debt = 0;
    let settled = 0;
    for (const sl of byCard.get(key) ?? []) {
      debt += sl.debt;
      settled += sl.settled;
    }
    for (const o of occ) {
      if (o.cardId || o.type !== 'expense' || o.category !== 'debts' || monthKey(o.date) !== key) continue;
      if (o.confirmed) settled += o.amount;
      else debt += o.amount;
    }
    out.push({ key, debt, settled });
  }
  return out;
}
