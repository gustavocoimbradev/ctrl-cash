import { t } from '../i18n';
import { formatMoney } from './money';
import { formatRunway } from './wealth';

/**
 * The abundance view: what is LEFT OVER (the balance that stays in the account) is the star. Everything here only
 * looks at leftovers growing: how much was kept, for how many months in a row, and how close the next milestone is.
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

/** Milestones, in months of average spending covered by the leftovers. */
export interface Milestone {
  id: string;
  /** how many months of spending the leftovers cover */
  months: number;
  icon: 'sunrise' | 'sun' | 'umbrella' | 'shield' | 'award' | 'star' | 'zap';
}

export const MILESTONES: Milestone[] = [
  { id: 'week', months: 7 / 30, icon: 'sunrise' },
  { id: 'month', months: 1, icon: 'sun' },
  { id: 'quarter', months: 3, icon: 'umbrella' },
  { id: 'half', months: 6, icon: 'shield' },
  { id: 'year', months: 12, icon: 'award' },
  { id: 'two', months: 24, icon: 'star' },
  { id: 'five', months: 60, icon: 'zap' },
];

export interface MilestoneProgress {
  /** milestones already reached, in order */
  reached: Milestone[];
  /** the next one; null when all are reached */
  next: Milestone | null;
  /** progress between the last reached milestone (or zero) and the next one, 0 to 1 */
  ratio: number;
  /** cents still missing for the next one */
  missing: number;
}

/** Where the leftovers stand among the milestones. Without spending to measure there is nothing to compare. */
export function milestoneProgress(leftovers: number, avgExpense: number): MilestoneProgress | null {
  if (avgExpense <= 0) return null;
  const months = Math.max(leftovers, 0) / avgExpense;
  const reached = MILESTONES.filter((m) => months >= m.months);
  const last = MILESTONES[MILESTONES.length - 1]!;
  // past the last fixed milestone the goal keeps moving: one more every 5 years of spending covered (10, 15, 20...)
  const beyond = months >= last.months ? (Math.floor(months / 60) + 1) * 60 : 0;
  const next = beyond ? { id: `y${beyond / 12}`, months: beyond, icon: last.icon } : (MILESTONES.find((m) => months < m.months) ?? null);
  if (!next) return { reached, next, ratio: 1, missing: 0 };
  const from = beyond ? beyond - 60 : reached.length ? reached[reached.length - 1].months : 0;
  return { reached, next, ratio: (months - from) / (next.months - from), missing: Math.max(Math.round(next.months * avgExpense - Math.max(leftovers, 0)), 0) };
}

/** "1 week", "1 month", "3 months", "1 year" for a milestone. */
export function milestoneName(m: Milestone): string {
  if (m.id === 'week') return t('1 week of spending');
  return t('{time} of spending', { time: formatRunway(m.months) });
}

/** The ruler under the pile: how many months (or years) of spending it covers, on a scale whose end moves up as it grows. */
export interface WealthScale {
  /** the end of the scale, in months of spending */
  target: number;
  /** distance between two dotted lines, in months */
  step: number;
  /** how many parts the scale is split into */
  count: number;
  unit: 'months' | 'years';
  /** months of spending the pile covers now */
  months: number;
  /** how much of the scale is filled, 0 to 1 */
  ratio: number;
  /** cents still missing for the end of the scale */
  missing: number;
}

/** 6 months first (a line per month), then 12, 24, 60 and then every 5 years, so there is always a next end. */
export function wealthScale(leftovers: number, avgExpense: number): WealthScale | null {
  if (avgExpense <= 0) return null;
  const pile = Math.max(leftovers, 0);
  const months = pile / avgExpense;
  // the end always leaves room ahead: the bar never gets stuck at its last bit (the scale moves up at 75%)
  const target = [6, 12, 24, 60].find((x) => months < x * 0.75) ?? (Math.floor(months / 45) + 1) * 60;
  const step = target <= 6 ? 1 : target <= 12 ? 3 : target <= 24 ? 6 : target <= 60 ? 12 : target / 5;
  return { target, step, count: Math.round(target / step), unit: target <= 24 ? 'months' : 'years', months, ratio: Math.min(months / target, 1), missing: Math.max(Math.round(target * avgExpense - pile), 0) };
}

/** The number written under the `i`-th dotted line (1-based): months, or years once the scale is that long. */
export function scaleTick(sc: WealthScale, i: number): number {
  const m = sc.step * i;
  return sc.unit === 'years' ? m / 12 : m;
}

/** "6 months", "1 year", "10 years": the end of the scale. */
export function scaleEnd(sc: WealthScale): string {
  if (sc.unit === 'months') return sc.target === 1 ? t('1 month') : t('{n} months', { n: sc.target });
  const years = sc.target / 12;
  return years === 1 ? t('1 year') : t('{n} years', { n: years });
}
