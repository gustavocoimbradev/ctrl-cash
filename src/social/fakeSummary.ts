import { addMonthsToKey, currentMonthKey, daysInMonth } from '../domain/dates';
import { Summary } from './api';

/**
 * A made-up summary for the profile of somebody who has not shared theirs: the page is drawn complete (so it looks like what is
 * waiting once they share) but with numbers that come from nowhere. NOTHING here is derived from the person's real data and nothing
 * from the server is used, so removing the blur on the screen can only ever reveal this.
 */
export function fakeSummary(): Summary {
  const current = currentMonthKey();
  const months = Array.from({ length: 24 }, (_, i) => {
    const wave = Math.sin(i / 2.2);
    const spent = Math.round(52 + wave * 14 + (i % 3) * 2);
    return { key: addMonthsToKey(current, i - 12), spent, saved: 100 - spent, incomeRel: Math.round(96 + Math.cos(i / 3) * 12), categories: [] as Summary['months'][number]['categories'] };
  });
  const categories: Summary['categories'] = [
    { slug: 'bills', label: 'Bills', pct: 21.4, tone: 'necessary' },
    { slug: 'groceries', label: 'Groceries', pct: 11.8, tone: 'necessary' },
    { slug: 'car', label: 'Car', pct: 8.6, tone: 'comfort' },
    { slug: 'leisure', label: 'Leisure', pct: 6.2, tone: 'luxury' },
    { slug: 'investments', label: 'Investments', pct: 4.9, tone: 'healthy' },
    { slug: 'subscriptions', label: 'Subscriptions', pct: 2.7, tone: 'luxury' },
    { slug: 'health', label: 'Health', pct: 2.1, tone: 'necessary' },
  ];
  const n = daysInMonth(Number(current.slice(0, 4)), Number(current.slice(5, 7)));
  return {
    version: 2,
    generatedAt: 0,
    spent: 52,
    saved: 48,
    months: months.map((m) => ({ ...m, categories })),
    categories,
    days: {
      month: current,
      income: Array.from({ length: n }, (_, i) => (i < 4 ? 0 : 100)),
      spent: Array.from({ length: n }, (_, i) => Math.round((Math.min(i + 1, n) / n) * 520) / 10),
    },
    health: { score: 640, label: 'Good', wealth: 58, debt: 100, habits: 71, month: 100 },
  };
}
