import type { Summary } from '../social/api';
import { AppData } from '../types';
import { LOAN_CATEGORY, REFUND_CATEGORY, categoryLabel } from './categories';
import { addMonthsToKey, currentMonthKey, monthKey } from './dates';
import { buildInvoices } from './invoices';
import { buildOccurrences, monthOccurrences, monthTotals } from './transactions';

/** How many months (the current one included) the shared summary looks at. */
export const SUMMARY_MONTHS = 12;
const TOP_CATEGORIES = 40;

/**
 * The short picture of the finances that can be shared: income, expenses and what was left over in each of the last
 * months, and how the expenses split by category. Same rules as the month footer (Refund and Loan are neutral, card
 * invoices count on their due month). Nothing here identifies a single transaction.
 */
export function buildSummary(data: AppData, now = Date.now()): Summary {
  const current = currentMonthKey();
  const first = addMonthsToKey(current, -(SUMMARY_MONTHS - 1));
  const occ = buildOccurrences(data, current);
  const invoices = buildInvoices(data, occ);
  const months: Summary['months'] = [];
  for (let k = first; k <= current; k = addMonthsToKey(k, 1)) {
    const { income, expense } = monthTotals(monthOccurrences(occ, k), invoices.filter((i) => monthKey(i.dueDate) === k));
    months.push({ key: k, income, expense, left: income - expense });
  }
  // the categories of what was spent in those months (by the purchase date, so card purchases count where they were made)
  const byCategory = new Map<string, number>();
  for (const o of occ) {
    if (o.type !== 'expense' || o.category === REFUND_CATEGORY || o.category === LOAN_CATEGORY) continue;
    const key = monthKey(o.purchaseDate);
    if (key < first || key > current) continue;
    const slug = o.category ?? 'other';
    byCategory.set(slug, (byCategory.get(slug) ?? 0) + o.amount);
  }
  const categories = [...byCategory]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CATEGORIES)
    .map(([slug, amount]) => ({ slug, label: categoryLabel(slug).slice(0, 40), amount }));
  return { version: 1, generatedAt: now, months, categories };
}
