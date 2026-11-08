import type { Summary } from '../social/api';
import { AppData } from '../types';
import { LOAN_CATEGORY, REFUND_CATEGORY, categoryLabel } from './categories';
import { addMonthsToKey, currentMonthKey } from './dates';
import { buildOccurrences, monthOccurrences } from './transactions';

/** How many months (the current one included) the shared summary looks at. */
export const SUMMARY_MONTHS = 12;
const MAX_CATEGORIES = 40;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The shareable picture of the finances, in PERCENTAGES of income only: for each of the last months (that had income),
 * how much of the income was spent, how much was saved and how the spending split by category; and the same overall.
 * Refund and Loan are neutral (as everywhere). Card purchases count on the month their invoice is due. No amount and no
 * single transaction is ever part of it.
 */
export function buildSummary(data: AppData, now = Date.now()): Summary {
  const current = currentMonthKey();
  const first = addMonthsToKey(current, -(SUMMARY_MONTHS - 1));
  const occ = buildOccurrences(data, current);
  const months: Summary['months'] = [];
  const incomes: number[] = [];
  const overall = new Map<string, number>();
  let totalIncome = 0;
  let totalSpent = 0;

  for (let k = first; k <= current; k = addMonthsToKey(k, 1)) {
    let income = 0;
    const byCategory = new Map<string, number>();
    for (const o of monthOccurrences(occ, k)) {
      if (o.category === REFUND_CATEGORY || o.category === LOAN_CATEGORY) continue;
      if (o.type === 'income') {
        if (!o.cardId) income += o.amount;
      } else {
        const slug = o.category ?? 'other';
        byCategory.set(slug, (byCategory.get(slug) ?? 0) + o.amount);
      }
    }
    // a month without income has nothing to take a percentage of
    if (income <= 0) continue;
    const spent = [...byCategory.values()].reduce((a, b) => a + b, 0);
    for (const [slug, amount] of byCategory) overall.set(slug, (overall.get(slug) ?? 0) + amount);
    totalIncome += income;
    totalSpent += spent;
    incomes.push(income);
    months.push({
      key: k,
      incomeRel: 0, // filled below, once the average is known
      spent: round1((spent / income) * 100),
      saved: round1(100 - (spent / income) * 100),
      categories: [...byCategory]
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CATEGORIES)
        .map(([slug, amount]) => ({ slug, label: categoryLabel(slug).slice(0, 40), pct: round1((amount / income) * 100) })),
    });
  }

  // each month's income against the person's own average month: the shape of the income without any amount
  const average = totalIncome / Math.max(incomes.length, 1);
  months.forEach((m, i) => { m.incomeRel = average > 0 ? round1((incomes[i] / average) * 100) : 100; });

  const categories = totalIncome > 0
    ? [...overall]
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CATEGORIES)
        .map(([slug, amount]) => ({ slug, label: categoryLabel(slug).slice(0, 40), pct: round1((amount / totalIncome) * 100) }))
    : [];
  const spent = totalIncome > 0 ? round1((totalSpent / totalIncome) * 100) : 0;
  return { version: 2, generatedAt: now, spent, saved: totalIncome > 0 ? round1(100 - (totalSpent / totalIncome) * 100) : 0, months, categories };
}
