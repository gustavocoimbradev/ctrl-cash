import { AppData, CreditCard, InvoicePayment, Installment, Occurrence, OccurrenceFields, Transaction } from '../types';
import { REFUND_CATEGORY, LOAN_CATEGORY } from './categories';
import { Invoice, dueDateFor, loanOf } from './invoices';
import { addMonths, addMonthsToKey, daysInMonth, monthKey, parseISO, toISO } from './dates';
import { newId } from './money';

/** Effective date: due date of the chosen invoice (card) or the date itself. */
function effectiveDate(card: CreditCard | undefined, purchase: string, invoiceKey?: string): string {
  return card && invoiceKey ? dueDateFor(card, invoiceKey) : purchase;
}

/** Effective values of a fixed transaction in a month: base, then "this and following", then "only this". */
export function fixedFieldsAt(tx: Transaction, mKey: string): Required<Omit<OccurrenceFields, 'category'>> & { category?: string } {
  const out: Required<Omit<OccurrenceFields, 'category'>> & { category?: string } = {
    description: tx.description,
    amount: tx.amount,
    category: tx.category,
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

/** Same month, another day (clamped to the last day of the month). */
export function withDay(iso: string, day: number): string {
  const { y, m } = parseISO(iso);
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

function toOccurrence(
  tx: Transaction,
  card: CreditCard | undefined,
  purchaseDate: string,
  mKey: string,
  order: number,
  invoiceKey?: string,
  fields?: { description: string; amount: number; category?: string },
): Occurrence {
  return {
    key: tx.fixed ? `${tx.id}@${mKey}` : tx.id,
    transactionId: tx.id,
    type: tx.type,
    description: fields?.description ?? tx.description,
    amount: fields?.amount ?? tx.amount,
    date: effectiveDate(card, purchaseDate, invoiceKey),
    purchaseDate,
    confirmed: tx.fixed ? tx.confirmedMonths.includes(mKey) : tx.confirmed,
    fixed: tx.fixed,
    cardId: tx.cardId,
    reserveId: tx.reserveId,
    category: fields ? fields.category : tx.category,
    installment: tx.installment,
    order,
    monthKey: mKey,
  };
}

/**
 * Expands transactions into occurrences. Non-fixed transactions always yield one
 * occurrence; fixed ones yield one per month up to `untilMonthKey` (inclusive).
 */
export function buildOccurrences(data: AppData, untilMonthKey: string): Occurrence[] {
  const cards = new Map(data.cards.map((c) => [c.id, c]));
  const out: Occurrence[] = [];
  data.transactions.forEach((tx, order) => {
    const card = tx.cardId ? cards.get(tx.cardId) : undefined;
    if (!tx.fixed) {
      out.push(toOccurrence(tx, card, tx.date, monthKey(tx.date), order, tx.invoiceKey));
      return;
    }
    const startKey = monthKey(tx.date);
    for (let i = 0; addMonthsToKey(startKey, i) <= addMonthsToKey(untilMonthKey, 0); i++) {
      const base = addMonths(tx.date, i);
      const mKey = monthKey(base);
      const f = fixedFieldsAt(tx, mKey);
      const purchase = withDay(base, f.day);
      const invoiceKey = tx.invoiceKey ? addMonthsToKey(tx.invoiceKey, i) : undefined;
      out.push(toOccurrence(tx, card, purchase, mKey, order, invoiceKey, f));
    }
  });
  return out;
}

const signed = (o: Occurrence) => (o.type === 'income' ? o.amount : -o.amount);

/**
 * Current balance of the month: accumulation of everything **confirmed** in the account up to the end
 * of the displayed month (earlier months included), minus invoice payments
 * made by then. Pending is excluded. Card purchases only affect the balance via
 * invoice payment. There is no separate reserve: everything left over is wealth
 * accumulates in this same balance.
 */
export function currentBalance(occ: Occurrence[], payments: InvoicePayment[], monthEnd: string): number {
  const account = occ.filter((o) => !o.cardId && o.confirmed && o.date <= monthEnd).reduce((s, o) => s + signed(o), 0);
  const paid = payments.filter((p) => p.date <= monthEnd).reduce((s, p) => s + p.amount, 0);
  return account - paid;
}

/**
 * End balance of the period: everything in the account up to the end of the month, plus the forecast of the
 * invoices due by then (the larger of total and paid) and the early
 * payments of future invoices.
 */
export function finalBalance(occ: Occurrence[], invoices: Invoice[], monthEnd: string): number {
  const account = occ.filter((o) => !o.cardId && o.date <= monthEnd).reduce((s, o) => s + signed(o), 0);
  const cards = invoices.reduce((s, inv) => {
    if (inv.dueDate <= monthEnd) return s + Math.max(inv.total, inv.paid);
    return s + inv.payments.filter((p) => p.date <= monthEnd).reduce((x, p) => x + p.amount, 0);
  }, 0);
  return account - cards;
}

export function monthOccurrences(occ: Occurrence[], key: string): Occurrence[] {
  return occ
    .filter((o) => monthKey(o.date) === key)
        // ascending day of month; within a day, creation order (oldest first)
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
}

/** Month totals: account transactions + invoices due in the month. */
export function monthTotals(list: Occurrence[], monthInvoices: Invoice[]) {
  let income = 0;
  let expense = 0;
  for (const o of list) {
    if (o.cardId) continue;
    // Refund (what third parties pay back) and Loan are neutral: neither your income nor your spending
    if (o.category === REFUND_CATEGORY || o.category === LOAN_CATEGORY) continue;
    if (o.type === 'income') income += o.amount;
    else expense += o.amount;
  }
  for (const inv of monthInvoices) expense += Math.max(Math.max(inv.total, inv.paid) - loanOf(inv), 0);
  return { income, expense };
}

export interface NewTransactionInput {
  type: Transaction['type'];
  description: string;
  amount: number;
  date: string;
  confirmed: boolean;
  fixed: boolean;
  cardId?: string;
  reserveId?: string;
  /** chosen invoice (due month); the 1st installment lands on it and the rest on the following ones */
  invoiceKey?: string;
  category?: string;
  installments: number;
}

/** Creates the transaction(s); installments become independent transactions. */
export function createTransactions(input: NewTransactionInput): Transaction[] {
  const base = {
    type: input.type,
    fixed: input.fixed,
    confirmedMonths: input.fixed && input.confirmed ? [monthKey(input.date)] : [],
    cardId: input.cardId,
    reserveId: input.reserveId,
    category: input.category,
  };
  const invoiceAt = (i: number) => (input.cardId && input.invoiceKey ? addMonthsToKey(input.invoiceKey, i) : undefined);
  const now = Date.now();
  if (input.fixed || input.installments <= 1) {
    return [{
      ...base,
      id: newId(),
      description: input.description,
      amount: input.amount,
      date: input.date,
      confirmed: input.confirmed,
      invoiceKey: invoiceAt(0),
      createdAt: now,
    }];
  }
  const total = input.installments;
  const groupId = newId();
  const each = Math.floor(input.amount / total);
  const remainder = input.amount - each * total;
  return Array.from({ length: total }, (_, i) => {
    const installment: Installment = { index: i + 1, total, groupId };
    return {
      ...base,
      id: newId(),
      description: input.description,
      amount: i === 0 ? each + remainder : each,
      date: addMonths(input.date, i),
      confirmed: i === 0 ? input.confirmed : false,
      invoiceKey: invoiceAt(i),
      createdAt: now + i,
      installment,
    };
  });
}

export interface DayGroup<T extends { date: string }> {
  day: number;
  items: T[];
}

/** Groups items (already sorted) by day of the month. */
export function groupByDay<T extends { date: string }>(list: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const o of list) {
    const day = Number(o.date.slice(8, 10));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(o);
    else groups.push({ day, items: [o] });
  }
  return groups;
}
