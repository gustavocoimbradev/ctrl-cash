import { AppData } from '../types';
import { categoryOf } from './categories';
import { addMonthsToKey, currentMonthKey, endOfMonth, monthKey, todayISO } from './dates';
import { buildInvoices, cardUsed } from './invoices';
import { projectWealth } from './projection';
import { buildOccurrences, currentBalance, monthOccurrences, monthTotals } from './transactions';
import { Health, financialHealth, netWorth, pendingCommitments, runwayMonths, spendQuality } from './wealth';

/**
 * The financial health of the CURRENT month, worked out from the data alone (the dashboard does the same sums for the
 * month on screen). Used to share the score. null when there is nothing to measure yet.
 */
export function currentHealth(data: AppData, today = todayISO()): { health: Health; balance: number; avgExpense: number } | null {
  const cur = currentMonthKey();
  const occ = buildOccurrences(data, cur);
  const invoices = buildInvoices(data, occ);
  const cardById = new Map(data.cards.map((x) => [x.id, x]));

  let spent = 0;
  for (let k = 0; k < 3; k++) {
    const key = addMonthsToKey(cur, -k);
    spent += monthTotals(monthOccurrences(occ, key).filter((o) => !o.cardId), invoices.filter((i) => monthKey(i.dueDate) === key)).expense;
  }
  const avgExpense = Math.round(spent / 3);

  const recent = new Set([0, 1, 2].map((k) => addMonthsToKey(cur, -k)));
  const quality = spendQuality(
    occ
      .filter((o) => o.type === 'expense' && o.category !== 'loan' && recent.has(monthKey(o.purchaseDate)) && (!o.cardId || cardById.has(o.cardId)))
      .map((o) => ({ amount: o.amount, weight: categoryOf(o.category).weight, planned: o.fixed || !!o.installment })),
  );

  const totals = monthTotals(monthOccurrences(occ, cur).filter((o) => !o.cardId), invoices.filter((i) => monthKey(i.dueDate) === cur));
  const debt = data.cards.reduce((sum, card) => sum + cardUsed(invoices, card.id, today), 0);
  const balance = currentBalance(occ, data.payments, endOfMonth(cur));
  const worth = netWorth(balance, debt, pendingCommitments(occ, endOfMonth(cur)));
  const health = financialHealth(runwayMonths(worth, avgExpense), debt, avgExpense, quality, { left: totals.income - totals.expense, income: totals.income });
  return health ? { health, balance, avgExpense } : null;
}

export const PROJECTION_MONTHS = 24;

/**
 * The wealth projection as PERCENTAGES, never amounts: each month's accumulated wealth as a change from today's, in
 * percent of today's (or, with nothing accumulated yet, of one average month of spending). Two lines like the dashboard:
 * what is already planned, and the same minus the usual one-off spending.
 */
export function wealthProjectionPct(data: AppData, balance: number, avgExpense: number): { start: string; planned: number[]; habit: number[] } | null {
  const base = Math.abs(balance) > 0 ? Math.abs(balance) : avgExpense;
  if (base <= 0) return null;
  const start = currentMonthKey();
  const p = projectWealth(data, start, PROJECTION_MONTHS);
  const pct = (v: number) => Math.max(-1000, Math.min(1000, Math.round(((v - balance) / base) * 1000) / 10));
  return { start, planned: p.planned.map(pct), habit: p.habit.map(pct) };
}
