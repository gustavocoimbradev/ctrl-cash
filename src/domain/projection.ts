import { AppData, Occurrence } from '../types';
import { buildInvoices } from './invoices';
import { addMonthsToKey, endOfMonth, monthKey } from './dates';
import { buildOccurrences, finalBalance } from './transactions';

export interface Projection {
  /** months (YYYY-MM) from the start month */
  keys: string[];
  /** accumulated wealth at the end of each month based only on what is already recorded */
  planned: number[];
  /** the same, minus the one-off spending expected from the previous 3 months' history */
  habit: number[];
  /** average monthly one-off spending (previous 3 months) */
  avulsoAvg: number;
  /** difference between the two lines in the last month */
  gap: number;
}

/** One-off spending: an expense that is neither fixed nor installment (groceries, butcher, snacks...). */
const isAvulso = (o: Occurrence) => o.type === 'expense' && !o.fixed && !o.installment;

/**
 * Projection of accumulated wealth (each month's leftovers summed), from month `startKey` onward.
 * - **Planned**: end balance of each month with everything already recorded (income, expenses
 *   fixed, installments, invoices...).
 * - **By history**: the planned minus the average one-off spending of the previous 3 months (only what
 *   has not yet been recorded in the month), accumulated month by month. Three months keep a phase of
 *   very low or very high spending from distorting the projection.
 */
export function projectWealth(data: AppData, startKey: string, months: number): Projection {
  const lastKey = addMonthsToKey(startKey, months - 1);
  const occ = buildOccurrences(data, lastKey);
  const invoices = buildInvoices(data, occ);

  // one-off spending per month (by purchase date: on a card the purchase date applies)
  const avulsoByMonth = new Map<string, number>();
  for (const o of occ) {
    if (isAvulso(o)) avulsoByMonth.set(monthKey(o.purchaseDate), (avulsoByMonth.get(monthKey(o.purchaseDate)) ?? 0) + o.amount);
  }
  // average of the previous 3 months that had one-off spending (months without data do not pull the average down)
  const prev = [1, 2, 3].map((k) => avulsoByMonth.get(addMonthsToKey(startKey, -k)) ?? 0).filter((v) => v > 0);
  const avulsoAvg = prev.length ? Math.round(prev.reduce((s, v) => s + v, 0) / prev.length) : 0;

  const keys = Array.from({ length: months }, (_, i) => addMonthsToKey(startKey, i));
  const planned = keys.map((k) => finalBalance(occ, invoices, endOfMonth(k)));
  let cumulative = 0;
  const habit = keys.map((k, i) => {
    cumulative += Math.max(avulsoAvg - (avulsoByMonth.get(k) ?? 0), 0);
    return planned[i] - cumulative;
  });
  return { keys, planned, habit, avulsoAvg, gap: planned[planned.length - 1] - habit[habit.length - 1] };
}
