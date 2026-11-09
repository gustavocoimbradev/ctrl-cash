import { AppData } from '../types';
import { areaSummary, debtsSummary, debtsTimeline } from './areas';
import { LOAN_CATEGORY, REFUND_CATEGORY, categoryLabel, categoryOf } from './categories';
import { addMonthsToKey, currentMonthKey, monthKey, todayISO } from './dates';
import { currentHealth } from './health';
import { buildInvoices } from './invoices';
import { currencyDigits, minorUnit } from './money';
import { buildOccurrences, monthOccurrences, monthTotals } from './transactions';
import { financialProfile } from './wishAdvice';
import { getCurrency, getLanguage } from '../i18n';

/**
 * The picture of the person's finances the connected assistant reads (through the MCP server): the app makes it, like the
 * shared summary, and publishes it while an assistant is connected. Amounts are whole units of `currency` (1234.56), never
 * cents, so nothing can be misread. It is read-only on the server.
 */
export function buildAssistantSnapshot(data: AppData, now = Date.now()) {
  const today = todayISO();
  const cur = currentMonthKey();
  const digits = currencyDigits();
  const u = (cents: number) => Number((cents / minorUnit()).toFixed(digits));
  const p = financialProfile(data, today);
  const hp = currentHealth(data, today);

  const occ = buildOccurrences(data, addMonthsToKey(cur, 6));
  const invoices = buildInvoices(data, occ);

  // income, spending and leftover per month: a year back to six months ahead
  const months = Array.from({ length: 19 }, (_, i) => {
    const key = addMonthsToKey(cur, i - 12);
    const t = monthTotals(monthOccurrences(occ, key).filter((o) => !o.cardId), invoices.filter((inv) => monthKey(inv.dueDate) === key));
    return { month: key, income: u(t.income), expense: u(t.expense), leftover: u(t.income - t.expense) };
  }).filter((m) => m.income !== 0 || m.expense !== 0);

  // spending by category, by purchase month, the last 6 months
  const recentMonths = new Set(Array.from({ length: 6 }, (_, i) => addMonthsToKey(cur, -i)));
  const byCat = new Map<string, Record<string, number>>();
  for (const o of occ) {
    if (o.type !== 'expense' || o.category === LOAN_CATEGORY || o.category === REFUND_CATEGORY) continue;
    const m = monthKey(o.purchaseDate);
    if (!recentMonths.has(m)) continue;
    const slug = categoryOf(o.category).slug;
    const row = byCat.get(slug) ?? {};
    row[m] = (row[m] ?? 0) + o.amount;
    byCat.set(slug, row);
  }
  const categories = [...byCat].map(([slug, row]) => ({
    name: categoryLabel(slug),
    tone: categoryOf(slug).tone,
    byMonth: Object.fromEntries(Object.entries(row).map(([m, v]) => [m, u(v)])),
  }));

  const debts = debtsSummary(data);
  const area = (k: 'subscriptions' | 'bills' | 'delivery') => areaSummary(data, k);
  const sub = area('subscriptions');
  const bills = area('bills');
  const delivery = area('delivery');
  const lines = (items: ReturnType<typeof area>['items']) => items.map((i) => ({ name: i.description.slice(0, 60), amount: u(i.amount), day: i.day, date: i.date, card: data.cards.find((c) => c.id === i.cardId)?.name, paidThisMonth: i.paid }));

  const recent = occ
    .filter((o) => o.purchaseDate <= today)
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
    .slice(0, 40)
    .map((o) => ({ date: o.purchaseDate, type: o.type, name: o.description.slice(0, 60), amount: u(o.amount), category: categoryLabel(o.category, o.type), confirmed: o.confirmed, card: data.cards.find((c) => c.id === o.cardId)?.name }));

  return {
    version: 1 as const,
    generatedAt: now,
    today,
    month: cur,
    currency: getCurrency(),
    language: getLanguage(),
    overview: {
      balance: u(p.balance),
      cardDebt: u(p.debt),
      pendingCommitments: u(p.commitments),
      netWorth: u(p.worth),
      avgMonthlyIncome: u(p.avgIncome),
      avgMonthlyExpense: u(p.avgExpense),
      avgMonthlyLeftover: u(p.saving),
      runwayMonths: p.avgExpense > 0 ? Number((Math.max(p.worth, 0) / p.avgExpense).toFixed(1)) : null,
    },
    health: hp
      ? { score: hp.health.score, label: hp.health.label, partsPercent: { wealth: Math.round((hp.health.saved / 40) * 100), debtFree: Math.round((hp.health.debt / 30) * 100), healthySpending: Math.round((hp.health.habits / 30) * 100), monthResult: Math.round(hp.health.month * 100) } }
      : { score: 1000, label: 'Excellent', note: 'no data to judge yet' },
    months,
    categories,
    cards: p.cards.map((c) => ({ name: c.card.name, limit: u(c.limit), used: u(c.used), available: u(c.room), dueDay: c.card.dueDay })),
    debts: {
      owed: u(debts.owed),
      dueThisMonth: u(debts.thisMonth),
      shareOfIncome: Number(debts.share.toFixed(3)),
      items: debts.items.map((i) => ({ name: i.description.slice(0, 60), remaining: u(i.remaining), installmentsLeft: i.left, installments: i.total, each: u(i.next), endsAt: i.endsAt, nextDue: i.dueDate, card: data.cards.find((c) => c.id === i.cardId)?.name })),
      byMonth: debtsTimeline(data).filter((m) => m.debt + m.settled > 0).map((m) => ({ month: m.key, stillOwed: u(m.debt), alreadyPaid: u(m.settled) })),
    },
    subscriptions: { perMonth: u(sub.monthly), perYear: u(sub.yearly), shareOfIncome: Number(sub.share.toFixed(3)), items: lines(sub.items) },
    bills: { perMonth: u(bills.monthly), perYear: u(bills.yearly), shareOfIncome: Number(bills.share.toFixed(3)), paidThisMonth: u(bills.paidThisMonth), items: lines(bills.items) },
    delivery: { monthlyAverageLast3Months: u(delivery.monthly), perYear: u(delivery.yearly), shareOfIncome: Number(delivery.share.toFixed(3)), orders: lines(delivery.items).slice(0, 60) },
    recent,
  };
}
