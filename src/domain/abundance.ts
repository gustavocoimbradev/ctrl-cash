import { t } from '../i18n';
import { formatRunway } from './wealth';

/**
 * The abundance view: what is LEFT OVER (the balance that stays in the account) is the star. Everything here only
 * looks at leftovers growing: how much was kept, for how many months in a row, and how far the goal is.
 */

/** Income and expenses of one month (cards netted as in `monthTotals`), cents. */
export interface MonthResult {
  key: string;
  income: number;
  expense: number;
}

/** Share of the income that was kept, 0 to 1 (can be negative); null without income. */
export function savingsRate(left: number, income: number): number | null {
  return income > 0 ? left / income : null;
}

/**
 * Months in a row with something left over. `results` is newest first, index 0 being the CURRENT month: it counts when it
 * is already positive, and when it is not (yet) the streak is "open" rather than broken, so the person can still keep it
 * alive this month. An earlier month with no activity or no leftover ends the streak.
 */
export function leftoverStreak(results: MonthResult[]): { months: number; open: boolean } {
  const kept = (r: MonthResult) => r.income > 0 && r.income - r.expense > 0;
  const currentKept = results.length > 0 && kept(results[0]);
  let months = currentKept ? 1 : 0;
  for (let i = 1; i < results.length && kept(results[i]); i++) months += 1;
  return { months, open: results.length > 0 && !currentKept };
}

/** The largest leftover of an earlier month (index 1 onwards); 0 when none was positive. */
export function bestPastMonth(results: MonthResult[]): number {
  return results.slice(1).reduce((m, r) => Math.max(m, r.income - r.expense), 0);
}

/** A new personal record: this month's leftover already beats every earlier month in the window. */
export function isRecordMonth(results: MonthResult[]): boolean {
  const left = results[0] ? results[0].income - results[0].expense : 0;
  return left > 0 && results.length > 1 && results.slice(1).some((r) => r.income > 0) && left > bestPastMonth(results);
}

/** What the pile covers, in months of average spending, and the next goal on the way up. */
export interface CoverGoal {
  months: number;
  goal: number;
}

/** The goals, in months: 1, 3, 6, 12, 18, 24 and then one year at a time (3 years, 4 years...). Reaching one moves to the next. */
const GOALS = [1, 3, 6, 12, 18, 24];

/** Without spending to measure there is nothing to compare. */
export function coverGoal(leftovers: number, avgExpense: number): CoverGoal | null {
  if (avgExpense <= 0) return null;
  const months = Math.max(leftovers, 0) / avgExpense;
  return { months, goal: GOALS.find((g) => months < g) ?? (Math.floor(months / 12) + 1) * 12 };
}

/** Whole numbers only: days under a month, then "1 month", "5 months", and years from two years on ("3 years"). */
export function coverLabel(months: number): string {
  if (months < 1) return formatRunway(months);
  if (months >= 24) return t('{n} years', { n: Math.round(months / 12) });
  const n = Math.round(months);
  return n === 1 ? t('1 month') : t('{n} months', { n });
}

/** Distances between two dotted lines, in months: days, months or years, depending on how far the goal is. */
function tickSteps(goal: number): number[] {
  if (goal <= 1) return [1 / 30, 2 / 30, 5 / 30];
  if (goal <= 24) return [1, 2, 3, 6];
  return [12, 24, 60, 120, 240, 600];
}

export interface CoverTick {
  /** where it falls on the bar, 0 to 1 (excluding the ends) */
  at: number;
  /** the stage it stands for, in months */
  months: number;
}

/** Dotted lines on the bar, one per stage (a few days, a month or a year, at most 12), each reached or still to reach. */
export function coverTicks(goal: number): CoverTick[] {
  const steps = tickSteps(goal);
  const step = steps.find((x) => goal / x <= 12) ?? steps[steps.length - 1]!;
  const out: CoverTick[] = [];
  for (let k = 1; k * step < goal - 1e-9; k++) out.push({ at: (k * step) / goal, months: k * step });
  return out;
}

/** The small subtle value under a dotted line, and at the goal: always a plain number, in the unit the covered label uses (days for a one-month goal, months, or years for long goals). */
export function tickText(months: number, goal: number): string {
  if (goal <= 1) return String(Math.round(months * 30));
  return String(goal > 24 ? Math.round(months / 12) : Math.round(months));
}
