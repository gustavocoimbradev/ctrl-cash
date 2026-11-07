import { AppData, CreditCard, InvoicePayment, Occurrence } from '../types';
import { LOAN_CATEGORY } from './categories';
import { openInvoiceKey as openKey } from './cards';
import { daysInMonth, monthKey, toISO } from './dates';

export interface Invoice {
  cardId: string;
  /** due month, YYYY-MM */
  key: string;
  dueDate: string;
  total: number;
  paid: number;
  items: Occurrence[];
  payments: InvoicePayment[];
}

/** Total never negative: a chargeback larger than the purchases zeroes the invoice. */
export const remaining = (inv: Invoice) => Math.max(inv.total - inv.paid, 0);

export function dueDateFor(card: CreditCard, key: string): string {
  const [y, m] = key.split('-').map(Number);
  return toISO(y, m, Math.min(card.dueDay, daysInMonth(y, m)));
}

/** Groups card expenses into invoices (by card and due month). */
export function buildInvoices(data: AppData, occ: Occurrence[]): Invoice[] {
  const cards = new Map(data.cards.map((c) => [c.id, c]));
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
  for (const o of occ) {
    if (!o.cardId || !cards.has(o.cardId)) continue;
    const inv = get(o.cardId, monthKey(o.date), o.date);
    inv.items.push(o);
    // income on the card = chargeback: reduces the invoice total
    inv.total += o.type === 'income' ? -o.amount : o.amount;
  }
  for (const p of data.payments) {
    const card = cards.get(p.cardId);
    if (!card) continue;
    const inv = get(p.cardId, p.invoiceKey, dueDateFor(card, p.invoiceKey));
    inv.payments.push(p);
    inv.paid += p.amount;
  }
  return [...map.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function findInvoice(invoices: Invoice[], card: CreditCard, key: string): Invoice {
  return (
    invoices.find((i) => i.cardId === card.id && i.key === key) ?? {
      cardId: card.id,
      key,
      dueDate: dueDateFor(card, key),
      total: 0,
      paid: 0,
      items: [],
      payments: [],
    }
  );
}

/** Fixed charge in a future month: shows on the invoice (forecast), but only counts as debt from the month of the **purchase date** (a purchase made cannot be undone). */
export const isPending = (o: Occurrence, today: string) => o.fixed && monthKey(o.purchaseDate) > monthKey(today);

/**
 * Card debt: what has already been recorded and not yet paid on the
 * card's invoices. Future installments count; fixed ones count **from the current month backward** (those of
 * future months do not); Loans do not count.
 */
export function cardUsed(invoices: Invoice[], cardId: string, today: string): number {
  return invoices.filter((i) => i.cardId === cardId).reduce((s, i) => s + invoiceDebt(i, today).amount, 0);
}

/** Debt of an invoice and the own items that make it up (without loans or fixed charges of future months). */
export function invoiceDebt(i: Invoice, today: string): { amount: number; items: Occurrence[]; loans: Occurrence[] } {
  const launched = i.items.filter((o) => !isPending(o, today));
  const sum = (list: Occurrence[]) => list.reduce((x, o) => x + (o.type === 'income' ? -o.amount : o.amount), 0);
  const open = Math.max(sum(launched) - i.paid, 0);
  // Loan (card lent to third parties) is not your debt: at most the own part of what remains to be paid is left.
  const own = launched.filter((o) => o.category !== LOAN_CATEGORY);
  return { amount: Math.min(open, Math.max(sum(own), 0)), items: own, loans: launched.filter((o) => o.category === LOAN_CATEGORY) };
}

/** Part of the invoice that is a Loan (third-party money on your card). */
export const loanOf = (inv: Invoice) => inv.items.filter((o) => o.type === 'expense' && o.category === LOAN_CATEGORY).reduce((s, o) => s + o.amount, 0);

/** Invoice open today: the one that receives purchases made on the given date. */
export const openInvoiceKey = openKey;

/** Next invoice to pay: the oldest with a balance; otherwise the one open today. */
export function defaultInvoiceKey(invoices: Invoice[], card: CreditCard, today: string): string {
  const unpaid = invoices.find((i) => i.cardId === card.id && remaining(i) > 0);
  return unpaid?.key ?? openInvoiceKey(card, today);
}
