import { AppData, CreditCard } from '../types';
import { addMonthsToKey, currentMonthKey, endOfMonth, monthKey, monthLabel, todayISO } from './dates';
import { buildInvoices, cardUsed } from './invoices';
import { formatMoney } from './money';
import { buildOccurrences, currentBalance, monthOccurrences, monthTotals } from './transactions';
import { netWorth, pendingCommitments } from './wealth';
import { t } from '../i18n';

/** What the person's own numbers say about how much room they have: cash, monthly leftover, cards. */
export interface FinancialProfile {
  /** cash in hand now */
  balance: number;
  debt: number;
  commitments: number;
  /** balance - debt - commitments */
  worth: number;
  /** average monthly spending / income / leftover of the last 3 months */
  avgExpense: number;
  avgIncome: number;
  saving: number;
  cards: { card: CreditCard; limit: number; used: number; room: number }[];
  limitTotal: number;
  limitUsed: number;
}

export function financialProfile(data: AppData, today = todayISO()): FinancialProfile {
  const cur = currentMonthKey();
  const occ = buildOccurrences(data, cur);
  const invoices = buildInvoices(data, occ);
  let spent = 0;
  const incomes: number[] = [];
  for (let k = 0; k < 3; k++) {
    const key = addMonthsToKey(cur, -k);
    const tot = monthTotals(monthOccurrences(occ, key).filter((o) => !o.cardId), invoices.filter((i) => monthKey(i.dueDate) === key));
    spent += tot.expense;
    if (tot.income > 0) incomes.push(tot.income);
  }
  const avgExpense = Math.round(spent / 3);
  const avgIncome = incomes.length ? Math.round(incomes.reduce((a, b) => a + b, 0) / incomes.length) : 0;
  const cards = data.cards.filter((c) => !c.archivedAt).map((card) => {
    const used = cardUsed(invoices, card.id, today);
    return { card, limit: card.limit, used, room: Math.max(card.limit - used, 0) };
  });
  const debt = data.cards.reduce((s, c) => s + cardUsed(invoices, c.id, today), 0);
  const balance = currentBalance(occ, data.payments, endOfMonth(cur));
  const commitments = pendingCommitments(occ, endOfMonth(cur));
  return {
    balance,
    debt,
    commitments,
    worth: netWorth(balance, debt, commitments),
    avgExpense,
    avgIncome,
    saving: avgIncome > 0 ? avgIncome - avgExpense : 0,
    cards,
    limitTotal: cards.reduce((s, c) => s + c.limit, 0),
    limitUsed: cards.reduce((s, c) => s + c.used, 0),
  };
}

export type Verdict = 'cash' | 'wait' | 'installments' | 'notYet' | 'unknown';

export interface Advice {
  verdict: Verdict;
  headline: string;
  reasons: { tone: 'good' | 'bad' | 'neutral'; text: string }[];
}

/** Months of spending kept untouched as a cushion before money counts as free to spend. */
const CUSHION_MONTHS = 3;
/** The share of the card limit that may be in use after a purchase before the card stops being a safety net. */
const MAX_LIMIT_USE = 0.6;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Whether, when and how to buy something that costs `price`, from the person's own profile:
 * - in cash when it fits beyond a cushion of 3 months of spending (no interest, the card limit stays free);
 * - otherwise waiting a few months while saving what is left over each month;
 * - in installments only when the limit has room, using it stays under 60%, there is no big debt and the installment fits the
 *   monthly leftover. Without a cushion the card IS the reserve, so committing it is called out;
 * - else "not yet", with what it would take.
 */
export function wishAdvice(p: FinancialProfile, price: number | undefined): Advice {
  if (!price || price <= 0) return { verdict: 'unknown', headline: t('Add a price to get advice'), reasons: [{ tone: 'neutral', text: t('With a price, this tells you if it is better to buy in cash, in installments or to wait.') }] };
  const reasons: Advice['reasons'] = [];
  const say = (tone: 'good' | 'bad' | 'neutral', text: string) => reasons.push({ tone, text });
  const cur = currentMonthKey();
  const cushion = CUSHION_MONTHS * p.avgExpense;
  const safeCash = Math.max(0, p.worth - cushion);
  const noCushion = p.avgExpense > 0 && p.worth < cushion;

  // 1. fits in cash beyond the cushion
  if (price <= safeCash) {
    say('good', t('You have {amount} free beyond a 3 month cushion of expenses.', { amount: formatMoney(safeCash) }));
    say('good', t('Paying in cash has no interest and leaves your card limit free for emergencies.'));
    say('neutral', t('Ask for a cash discount: many stores give one.'));
    return { verdict: 'cash', headline: t('Buy it in cash'), reasons };
  }

  // 2. a few months of saving gets there
  if (p.saving > 0) {
    const months = Math.ceil((price - safeCash) / p.saving);
    if (months <= 4) {
      say('good', t('You leave about {amount} over each month.', { amount: formatMoney(p.saving) }));
      say('good', t('Saving it, you can pay in cash in {month}, with no interest and without touching your card.', { month: monthLabel(addMonthsToKey(cur, months)) }));
      return { verdict: 'wait', headline: months === 1 ? t('Wait one month and pay in cash') : t('Wait {n} months and pay in cash', { n: months }), reasons };
    }
  }

  // 3. installments, only if the card can carry it
  const afterUse = p.limitTotal > 0 ? (p.limitUsed + price) / p.limitTotal : 1;
  const budget = p.saving > 0 ? p.saving * 0.3 : p.avgIncome * 0.1;
  const best = [...p.cards].sort((a, b) => b.room - a.room)[0];
  const fits = best && price <= best.room && afterUse <= MAX_LIMIT_USE;
  const bigDebt = p.avgExpense > 0 && p.debt > p.avgExpense;
  if (fits && !bigDebt && budget > 0) {
    let n = 2;
    while (n < 12 && price / n > budget) n++;
    if (price / n <= budget) {
      const amount = formatMoney(Math.round(price / n));
      say('good', t('It fits your card: it would use {share} of your total limit.', { share: pct(afterUse) }));
      say('good', t('{amount} a month is within what you leave over.', { amount }));
      if (noCushion) say('bad', t('You have no cushion: your card limit is your safety net, and this commits part of it.'));
      say('neutral', t('Only choose installments if they have no interest; with interest, wait and pay in cash.'));
      say('neutral', t('Buy on day {day} of the month or later, just after your {card} invoice due date, so the first installment only comes next month.', { day: Math.min(best.card.dueDay + 1, 28), card: best.card.name }));
      return { verdict: 'installments', headline: t('Pay in {n} installments of {amount}', { n, amount }), reasons };
    }
  }

  // 4. not yet
  if (bigDebt) say('bad', t('You already owe {amount} on cards, more than a month of your spending. Pay that first.', { amount: formatMoney(p.debt) }));
  if (p.limitTotal > 0 && afterUse > MAX_LIMIT_USE) say('bad', t('It would take your card use to {share} of the limit, too much when the card is your safety net.', { share: pct(afterUse) }));
  if (p.limitTotal === 0) say('neutral', t('You have no card registered, so only cash or saving up are options.'));
  if (noCushion) say('bad', t('You have less than 3 months of expenses saved, so spending on this now is risky.'));
  if (p.saving > 0) {
    const months = Math.ceil((price - safeCash) / p.saving);
    say('neutral', t('Saving {amount} a month you would get there in about {n} months.', { amount: formatMoney(p.saving), n: months }));
  } else {
    say('bad', t('You are not leaving money over each month yet: start there.'));
  }
  return { verdict: 'notYet', headline: t('Not yet'), reasons };
}
