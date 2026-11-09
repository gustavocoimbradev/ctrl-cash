import { t } from '../i18n';
import { categoryLabel } from './categories';
import { formatMoney } from './money';
import { Health, Spend, formatRunway, spendQuality } from './wealth';

export interface InsightInput {
  health: Health | null;
  /** months the person could live without income */
  runway: number | null;
  /** card debt, cents */
  debt: number;
  /** average monthly expense, cents */
  avgExpense: number;
  /** accumulated wealth, cents */
  accumulated: number;
  /** pending commitments, cents */
  commitments: number;
  /** spending of the last 3 months, with its category */
  spends: (Spend & { category: string })[];
  /** income minus expenses of the displayed month, cents */
  monthLeft: number;
  /** total limit of the active cards and what is used, cents */
  cardLimit: number;
  cardUsed: number;
}

export type Impact = 'high' | 'medium' | 'low';

/** One thing that is making the score go down or up, in plain words. */
export interface ScoreFactor {
  id: string;
  /** negative: pulling the score down; positive: pushing it up */
  tone: 'negative' | 'positive';
  /** Feather icon name */
  icon: string;
  title: string;
  text: string;
  /** how much it weighs on the score */
  impact: Impact;
}

const IMPACT_RANK: Record<Impact, number> = { high: 0, medium: 1, low: 2 };

/**
 * What is behind the financial health score, like a credit bureau does: plain statements about
 * what pulls the score down and what pushes it up, each with its impact. Descriptive (it says how
 * things are, not what to do), rule based and built from the same numbers the score uses.
 */
export function buildScoreFactors(i: InsightInput): ScoreFactor[] {
  const h = i.health;
  // no data yet: the score starts at its best, so what makes it up is shown as good (it changes as data comes in)
  if (!h || i.avgExpense <= 0) {
    return [
      { id: 'start-debt', tone: 'positive', icon: 'shield', impact: 'high', title: t('You have no card debt'), text: t('Nothing is owed on cards, so the Debt-free part of your score is complete.') },
      { id: 'start-wealth', tone: 'positive', icon: 'trending-up', impact: 'high', title: t('A clean start'), text: t('Your Wealth part grows as you leave money over each month; 12 months of expenses saved completes it.') },
      { id: 'start-habits', tone: 'positive', icon: 'heart', impact: 'medium', title: t('Healthy spending so far'), text: t('Your spending habits count as healthy until there is something to judge.') },
    ];
  }
  const out: ScoreFactor[] = [];
  const neg = (f: Omit<ScoreFactor, 'tone'>) => out.push({ ...f, tone: 'negative' });
  const pos = (f: Omit<ScoreFactor, 'tone'>) => out.push({ ...f, tone: 'positive' });
  const wealth = Math.max(i.accumulated, 0);

  // spending versus income, this month
  if (i.monthLeft < 0) {
    neg({ id: 'overspend', icon: 'trending-down', impact: 'high', title: t('You spend more than you earn'), text: t('This month your expenses are {amount} above your income.', { amount: formatMoney(-i.monthLeft) }) });
  } else if (i.monthLeft > 0) {
    pos({ id: 'leftover', icon: 'trending-up', impact: 'medium', title: t('You spend less than you earn'), text: t('{amount} is left over this month, about {months} months of expenses.', { amount: formatMoney(i.monthLeft), months: (i.monthLeft / i.avgExpense).toFixed(1) }) });
  }

  // card debt (30 points of the score)
  if (i.debt > 0) {
    const months = i.debt / i.avgExpense;
    neg({
      id: 'debt',
      icon: 'credit-card',
      impact: months >= 2 ? 'high' : months >= 1 ? 'medium' : 'low',
      title: t('You have card debt'),
      text: t('You owe {amount} on cards, about {months} months of your expenses.', { amount: formatMoney(i.debt), months: months.toFixed(1) }),
    });
    if (i.debt > wealth) {
      neg({ id: 'debt-vs-wealth', icon: 'alert-triangle', impact: 'high', title: t('Your debts are bigger than your wealth can cover'), text: t('{debt} owed against {wealth} accumulated.', { debt: formatMoney(i.debt), wealth: formatMoney(wealth) }) });
    }
  } else {
    pos({ id: 'no-debt', icon: 'shield', impact: 'high', title: t('You have no card debt'), text: t('Your cards are paid, so the Debt-free part of your score is complete.') });
  }

  // pending commitments versus wealth
  if (i.commitments > 0) {
    if (i.commitments > wealth) {
      neg({ id: 'commitments', icon: 'clock', impact: 'medium', title: t('Your pending bills are bigger than what you have'), text: t('{bills} still to pay against {wealth} accumulated.', { bills: formatMoney(i.commitments), wealth: formatMoney(wealth) }) });
    } else {
      pos({ id: 'commitments-covered', icon: 'clock', impact: 'low', title: t('Your pending bills are covered'), text: t('What you have accumulated ({wealth}) is enough for the {bills} still to pay.', { wealth: formatMoney(wealth), bills: formatMoney(i.commitments) }) });
    }
  }

  // cushion (40 points of the score, complete at 12 months)
  if (i.runway !== null) {
    if (i.runway < 3) {
      neg({ id: 'cushion-short', icon: 'battery-charging', impact: i.runway < 1 ? 'high' : 'medium', title: t('Your cushion is short'), text: t('You could live {time} without income; 12 months is the healthy mark.', { time: formatRunway(i.runway) }) });
    } else if (i.runway < 12) {
      neg({ id: 'cushion-partial', icon: 'battery-charging', impact: 'low', title: t('Your cushion is still growing'), text: t('You could live {time} without income, short of the 12 months that complete this part of the score.', { time: formatRunway(i.runway) }) });
    } else {
      pos({ id: 'cushion-full', icon: 'award', impact: 'high', title: t('Your cushion is complete'), text: t('You could live {time} without income.', { time: formatRunway(i.runway) }) });
    }
    if (i.runway >= 3 && i.runway < 12 && i.runway >= 6) {
      pos({ id: 'cushion-solid', icon: 'umbrella', impact: 'medium', title: t('You have a solid cushion'), text: t('{time} of expenses are already covered.', { time: formatRunway(i.runway) }) });
    }
  }

  // spending quality (30 points of the score)
  const total = i.spends.reduce((s, x) => s + x.amount, 0);
  const quality = spendQuality(i.spends);
  if (quality !== null && total > 0) {
    if (quality < 0.8) {
      const weight = new Map<string, number>();
      for (const s of i.spends) weight.set(s.category, (weight.get(s.category) ?? 0) + s.amount * s.weight * (s.planned ? 0.6 : 1));
      const [top, topWeight] = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topWeight > 0) {
        const share = Math.round((i.spends.filter((s) => s.category === top).reduce((a, s) => a + s.amount, 0) / total) * 100);
        neg({
          id: 'category',
          icon: 'pie-chart',
          impact: quality < 0.5 ? 'high' : 'medium',
          title: t('A lot of your spending goes to {category}', { category: categoryLabel(top) }),
          text: t('{category} is {share}% of what you spent in the last 3 months and weighs the most against your score.', { category: categoryLabel(top), share }),
        });
      }
    } else {
      pos({ id: 'quality', icon: 'check-circle', impact: 'medium', title: t('Your spending is well chosen'), text: t('Most of what you spent in the last 3 months went to essential items.') });
    }
    const planned = i.spends.filter((s) => s.planned).reduce((a, s) => a + s.amount, 0) / total;
    if (planned < 0.4 && quality < 0.85) {
      neg({ id: 'unplanned', icon: 'shuffle', impact: 'low', title: t('Most of your spending is one-off'), text: t('Only {share}% was planned as fixed items or installments, and unplanned spending counts more against you.', { share: Math.round(planned * 100) }) });
    } else if (planned >= 0.6) {
      pos({ id: 'planned', icon: 'calendar', impact: 'low', title: t('Most of your spending is planned'), text: t('{share}% of it is fixed items or installments, which count less against your score.', { share: Math.round(planned * 100) }) });
    }
  }

  // card limit use
  if (i.cardLimit > 0 && i.cardUsed / i.cardLimit > 0.5) {
    neg({ id: 'limit', icon: 'percent', impact: 'low', title: t('You use a big part of your card limit'), text: t('{share}% of your total limit is in use.', { share: Math.round((i.cardUsed / i.cardLimit) * 100) }) });
  }

  // heaviest first inside each side
  return out.sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact]);
}
