import type { Summary } from '../social/api';
import { AppData } from '../types';
import { LOAN_CATEGORY, REFUND_CATEGORY, categoryLabel, categoryOf, toneOfCategory } from './categories';
import { addMonthsToKey, currentMonthKey } from './dates';
import { currentHealth } from './health';
import { buildOccurrences, monthOccurrences } from './transactions';

/** The summary covers this many months back and ahead of now (the current month is the first of the "ahead"), so a viewer can pick 6, 12 or 24 months around today. */
export const SUMMARY_BACK = 12;
export const SUMMARY_AHEAD = 12;
const MAX_CATEGORIES = 40;

/** the owner's own classification of a category, shared with it */
const toneOf = (slug: string) => {
  const tone = toneOfCategory(slug);
  return tone ? { tone } : {};
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The shareable picture of the finances, in PERCENTAGES of income only: for each month from a year back to a year ahead (what is already planned counts for the future),
 * how much of the income was spent, how much was saved and how the spending split by category; and the same overall.
 * Refund and Loan are neutral (as everywhere). Card purchases count on the month their invoice is due. No amount and no
 * single transaction is ever part of it.
 */
export function buildSummary(data: AppData, now = Date.now()): Summary {
  const current = currentMonthKey();
  const first = addMonthsToKey(current, -SUMMARY_BACK);
  const last = addMonthsToKey(current, SUMMARY_AHEAD - 1);
  const occ = buildOccurrences(data, last);
  const months: Summary['months'] = [];
  const incomes: number[] = [];
  const overall = new Map<string, number>();
  let totalIncome = 0;
  let totalSpent = 0;

  for (let k = first; k <= last; k = addMonthsToKey(k, 1)) {
    let income = 0;
    const byCategory = new Map<string, number>();
    for (const o of monthOccurrences(occ, k)) {
      if (o.category === REFUND_CATEGORY || o.category === LOAN_CATEGORY) continue;
      if (o.type === 'income') {
        if (!o.cardId) income += o.amount;
      } else {
        // a category that no longer exists counts as "Other" (what the app shows for it), so there is only one of those
        const slug = categoryOf(o.category).slug;
        byCategory.set(slug, (byCategory.get(slug) ?? 0) + o.amount);
      }
    }
    // a month without income has nothing to take a percentage of: it stays in the list, empty, so the months stay in line
    if (income <= 0) {
      incomes.push(0);
      months.push({ key: k, spent: 0, saved: 0, incomeRel: 0, categories: [] });
      continue;
    }
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
        .map(([slug, amount]) => ({ slug, label: categoryLabel(slug).slice(0, 40), pct: round1((amount / income) * 100), ...toneOf(slug) })),
    });
  }

  // each month's income against the person's own average month (of the months that had income): the shape of the income, without any amount
  const average = totalIncome / Math.max(incomes.filter((v) => v > 0).length, 1);
  months.forEach((m, i) => { m.incomeRel = incomes[i] > 0 && average > 0 ? round1((incomes[i] / average) * 100) : 0; });

  const categories = totalIncome > 0
    ? [...overall]
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CATEGORIES)
        .map(([slug, amount]) => ({ slug, label: categoryLabel(slug).slice(0, 40), pct: round1((amount / totalIncome) * 100), ...toneOf(slug) }))
    : [];
  const spent = totalIncome > 0 ? round1((totalSpent / totalIncome) * 100) : 0;
  const hp = currentHealth(data);
  const health = hp ? { score: hp.health.score, label: hp.health.label, wealth: round1((hp.health.saved / 40) * 100), debt: round1((hp.health.debt / 30) * 100), habits: round1((hp.health.habits / 30) * 100), month: round1(hp.health.month * 100) } : undefined;
  return { version: 2, generatedAt: now, spent, saved: totalIncome > 0 ? round1(100 - (totalSpent / totalIncome) * 100) : 0, months, categories, ...(health ? { health } : {}) };
}
