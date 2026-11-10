import { t } from '../i18n';
import { formatRunway } from './wealth';

/**
 * The abundance view: what is LEFT OVER (the balance that stays in the account) is the star. Everything here only
 * looks at leftovers growing: how much was kept, for how many months in a row, and how close the next level is.
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

/** Short intentions, one a day, in the spirit of Transurfing: attention goes to the flow that grows, not to what is missing. */
const AFFIRMATIONS = [
  'You are already on the line of life where abundance grows.',
  'Let money arrive and stay: what you keep today shapes your tomorrow.',
  'Abundance is the natural state. Your wealth is the proof.',
  'Focus on what grows, and more of it finds you.',
  'Everything you accumulate is a vote for the life you are choosing.',
  'Picture your pile a year from now, and step into that picture.',
  'Gratitude for what came in opens space for more.',
  'You do not need to fight for money. Let it flow, and keep your share.',
  'Small amounts added, steady flow: a river is made of drops.',
  'Today is a good day to let a little more stay with you.',
];

/** The intention of the day (same all day, a new one tomorrow). `dayNumber` = days since any fixed date. */
export function dailyIntention(dayNumber: number): string {
  const i = ((dayNumber % AFFIRMATIONS.length) + AFFIRMATIONS.length) % AFFIRMATIONS.length;
  return t(AFFIRMATIONS[i]);
}

/**
 * Levels, in months of average spending the leftovers cover: 1 week, half a month, then a month at a time up to 6, then
 * 9, 12, 18, 24, 36, 48, 60 and a year at a time after that. The bar always runs from the level just reached to the next
 * one, so there is always a close goal to chase.
 */
const LEVELS = [7 / 30, 0.5, 1, 2, 3, 4, 5, 6, 9, 12, 18, 24, 36, 48, 60];

export interface LevelProgress {
  /** months of spending the pile covers now */
  months: number;
  /** the level just reached (0 before the first) and the next one, in months */
  from: number;
  to: number;
  /** how far along from `from` to `to`, 0 to 1 */
  ratio: number;
}

/** Where the pile stands between two levels. Without spending to measure there is nothing to compare. */
export function levelProgress(leftovers: number, avgExpense: number): LevelProgress | null {
  if (avgExpense <= 0) return null;
  const months = Math.max(leftovers, 0) / avgExpense;
  let from = 0;
  let to: number;
  const reached = LEVELS.filter((l) => months >= l).length;
  if (months < LEVELS[LEVELS.length - 1]!) {
    to = LEVELS[reached]!;
    from = reached ? LEVELS[reached - 1]! : 0;
  } else {
    from = Math.floor(months / 12) * 12;
    to = from + 12;
  }
  return { months, from, to, ratio: (months - from) / (to - from) };
}

/** "7 days", "1 month", "5 months", "3 years": a level written for people. */
export function levelLabel(months: number): string {
  if (months < 1) return formatRunway(months);
  if (months >= 12 && months % 12 === 0) return months === 12 ? t('1 year') : t('{n} years', { n: months / 12 });
  return months === 1 ? t('1 month') : t('{n} months', { n: months });
}
