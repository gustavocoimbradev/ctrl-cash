import { CreditCard, InvoicePayment, Occurrence } from '../types';
import { addMonthsToKey, monthKey } from './dates';
import { Invoice, invoiceDebt } from './invoices';

export interface MonthLeftover {
  key: string;
  /** month leftover: confirmed in - confirmed out (invoice payments included) */
  net: number;
  /** accumulated wealth at the end of the month */
  running: number;
}

/**
 * The leftovers of all months that make up the accumulated wealth (same calculation as the current balance:
 * everything confirmed in the account up to the end of the current month, minus invoice payments), from oldest to current.
 */
export function monthlyLeftovers(occ: Occurrence[], payments: InvoicePayment[], currentMonthEnd: string): MonthLeftover[] {
  const net = new Map<string, number>();
  const add = (iso: string, v: number) => net.set(monthKey(iso), (net.get(monthKey(iso)) ?? 0) + v);
  for (const o of occ) if (!o.cardId && o.confirmed && o.date <= currentMonthEnd) add(o.date, o.type === 'income' ? o.amount : -o.amount);
  for (const p of payments) if (p.date <= currentMonthEnd) add(p.date, -p.amount);
  const keys = [...net.keys()].sort();
  if (!keys.length) return [];
  const last = monthKey(currentMonthEnd);
  const out: MonthLeftover[] = [];
  let running = 0;
  for (let k = keys[0]; k <= last; k = addMonthsToKey(k, 1)) {
    const v = net.get(k) ?? 0;
    running += v;
    out.push({ key: k, net: v, running });
  }
  return out;
}

export interface DebtInvoice {
  key: string;
  dueDate: string;
  items: Occurrence[];
  /** loans (card passed to third parties): shown struck through, not summed */
  loans: Occurrence[];
  paid: number;
  amount: number;
}
export interface DebtCard {
  card: CreditCard;
  invoices: DebtInvoice[];
  total: number;
}

/** The list of debts by card and invoice that add up to the Card debt. */
export function debtBreakdown(invoices: Invoice[], cards: CreditCard[], today: string): DebtCard[] {
  return cards
    .map((card): DebtCard => {
      const list = invoices
        .filter((i) => i.cardId === card.id)
        .map((i) => ({ i, d: invoiceDebt(i, today) }))
        // invoice with debt, or only with unpaid loans (shown struck through, but not hidden)
        .filter(({ i, d }) => d.amount > 0 || (d.loans.length > 0 && i.paid < i.total))
        .map(({ i, d }): DebtInvoice => ({ key: i.key, dueDate: i.dueDate, items: d.items, loans: d.loans, paid: i.paid, amount: d.amount }));
      return { card, invoices: list, total: list.reduce((s, i) => s + i.amount, 0) };
    })
    .filter((c) => c.invoices.length > 0);
}

export interface TimelineSlice {
  card: CreditCard;
  /** open debt of the invoice in that month */
  debt: number;
  /** already-paid part (shown in the chart, but not part of the debt total) */
  settled: number;
}

/** For the debt chart: per invoice month, how much is open debt and how much was already paid (per card). */
export function debtTimeline(invoices: Invoice[], cards: CreditCard[], today: string): Map<string, TimelineSlice[]> {
  const map = new Map<string, TimelineSlice[]>();
  for (const card of cards) {
    for (const i of invoices.filter((x) => x.cardId === card.id)) {
      const d = invoiceDebt(i, today);
      const own = Math.max(d.items.reduce((s, o) => s + (o.type === 'income' ? -o.amount : o.amount), 0), 0);
      if (own <= 0) continue;
      map.set(i.key, [...(map.get(i.key) ?? []), { card, debt: d.amount, settled: Math.max(own - d.amount, 0) }]);
    }
  }
  return map;
}
