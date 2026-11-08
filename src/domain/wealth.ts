/** App focus: ACCUMULATE AS MUCH AS POSSIBLE. There is no separate reserve: each month's leftover is wealth. */

/**
 * Net worth: accumulated wealth (current balance) - card debt - pending commitments
 * (expenses already recorded and not yet paid, see `pendingCommitments`).
 */
export function netWorth(balance: number, cardDebt: number, commitments: number): number {
  return balance - cardDebt - commitments;
}

/**
 * Pending commitments of the account (outside the card, which already counts as debt): **unconfirmed**
 * expenses of the current and earlier months (overdue) and, in future months, only those that
 * are **not fixed** (installments and one-offs already recorded). Future fixed ones are excluded: they would be endless
 * accounts. `currentMonthEnd` = last day of the current month.
 */
export function pendingCommitments<T extends CommitmentLike>(occ: T[], currentMonthEnd: string): number {
  return commitmentItems(occ, currentMonthEnd).reduce((s, o) => s + o.amount, 0);
}

type CommitmentLike = { type: string; cardId?: string; category?: string; confirmed: boolean; fixed: boolean; date: string; amount: number };

/** The items that make up the pending commitments, by date. */
export function commitmentItems<T extends CommitmentLike>(occ: T[], currentMonthEnd: string): T[] {
  return occ
    .filter((o) => o.type === 'expense' && o.category !== 'loan' && !o.cardId && !o.confirmed && (o.date <= currentMonthEnd || !o.fixed))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Financial freedom spending plan: month by month, how much net worth remains if income
 * stops and you spend the monthly average, until it runs out (at most `max` months). Empty without wealth or expenses.
 */
export function runwayPlan(worth: number, avgMonthlyExpense: number, startKey: string, addMonths: (key: string, n: number) => string, max = 24): { key: string; spend: number; remaining: number }[] {
  if (worth <= 0 || avgMonthlyExpense <= 0) return [];
  const rows: { key: string; spend: number; remaining: number }[] = [];
  let left = worth;
  for (let i = 0; i < max && left > 0; i++) {
    const spend = Math.min(avgMonthlyExpense, left);
    left -= spend;
    rows.push({ key: addMonths(startKey, i), spend, remaining: left });
  }
  return rows;
}

/** For how many months wealth covers expenses if income stopped today; null without expenses. */
export function runwayMonths(worth: number, avgMonthlyExpense: number): number | null {
  return avgMonthlyExpense > 0 ? Math.max(worth, 0) / avgMonthlyExpense : null;
}

/** "12 days", "3.5 months", "1.4 years". */
export function formatRunway(months: number): string {
  const plural = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  if (months < 1) return plural(Math.round(months * 30), 'day');
  if (months < 12) return `${months.toFixed(1)} months`;
  return `${(months / 12).toFixed(1)} years`;
}

export interface Health {
  /** overall score, 0 to 1000 */
  score: number;
  /** points per factor: wealth up to 40, debt up to 30, spending up to 30 */
  saved: number;
  debt: number;
  habits: number;
  /** how much of the score the month's result keeps, 0 to 1 (1 = a healthy leftover, lower as it shrinks or turns negative) */
  month: number;
  label: 'Critical' | 'Warning' | 'Good' | 'Excellent';
}

/** Part of a spending item for measuring quality: amount, category weight and whether it was planned. */
export interface Spend {
  amount: number;
  /** category weight, 0 (essential) to 1 (frivolous) */
  weight: number;
  /** fixed or installment: was already planned */
  planned: boolean;
}

/** Planned spending weighs less: spending on a one-off shows a lack of planning. */
const PLANNED_FACTOR = 0.6;

/**
 * Spending quality, from 0 (all frivolous and unplanned) to 1 (all essential and
 * planned): 1 - weighted average of the weights. null without spending. Even essentials weigh
 * a little when unplanned.
 */
export function spendQuality(spends: Spend[]): number | null {
  const total = spends.reduce((s, x) => s + x.amount, 0);
  if (total <= 0) return null;
  const weighted = spends.reduce((s, x) => s + x.amount * x.weight * (x.planned ? PLANNED_FACTOR : 1), 0);
  return Math.max(0, 1 - weighted / total);
}

/**
 * Financial health (0 to 1000), looking at what you have, what you owe and how you spend:
 * - **Wealth** (40 pts): what you have already accumulated (each month's leftovers summed),
 *   measured by runway (peace of mind); full at 12 months;
 * - **Debt-free** (30 pts): card debt; drops to zero at 2 months of expenses;
 * - **Healthy spending** (30 pts): spending quality (categories and planning); with no spending, full.
 * Then the month's result scales the whole score (`monthResultKeep`): a small leftover, or spending more than you earn,
 * pulls it down a lot.
 * null without data to evaluate (no expenses to measure the runway).
 */
/**
 * How much of the score the month's result keeps. A leftover of 20% of the income or more costs nothing; below that
 * the score falls fast (a leftover of 0 keeps 50%), and spending more than you earn keeps at most 50% and goes down to
 * 15% when the shortfall is a quarter of the income or more (and the score never passes 499, "Warning", while the month
 * ends in the red). Without income there is nothing to compare: no penalty
 * unless the month is negative.
 */
export function monthResultKeep(left: number, income: number): number {
  if (income <= 0) return left < 0 ? 0.3 : 1;
  const ratio = left / income;
  if (ratio >= 0.2) return 1;
  if (ratio >= 0) return 0.5 + 0.5 * (ratio / 0.2);
  return Math.max(0.15, 0.5 - (-ratio / 0.25) * 0.35);
}

export function financialHealth(runway: number | null, debt: number, avgExpense: number, quality: number | null, monthResult?: { left: number; income: number }): Health | null {
  if (runway === null) return null;
  const saved = Math.min(runway / 12, 1) * 40;
  const debtPts = 30 * Math.max(0, 1 - debt / avgExpense / 2);
  const habits = quality === null ? 30 : 30 * quality;
  // factors add up to 100; the score is shown from 0 to 1000
  const month = monthResult ? monthResultKeep(monthResult.left, monthResult.income) : 1;
  let score = Math.round((saved + debtPts + habits) * 10 * month);
  // ending the month owing money is never "Good", whatever else is fine
  if (monthResult && monthResult.left < 0) score = Math.min(score, 499);
  const label = score < 250 ? 'Critical' : score < 500 ? 'Warning' : score < 750 ? 'Good' : 'Excellent';
  return { score, saved, debt: debtPts, habits, month, label };
}
