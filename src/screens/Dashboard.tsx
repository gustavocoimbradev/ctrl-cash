import { InstallCard } from '../components/InstallCard';
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '../components/Card';
import { ChartLegend, Gauge, ProjectionChart } from '../components/Charts';
import { CheckButton, PillToggle } from '../components/Controls';
import { AnimatedBar, Counter, Money } from '../components/Motion';
import { Reveal } from '../components/Reveal';
import { Fade } from '../components/Fade';
import { MonthNav } from '../components/MonthNav';
import { addMonthsToKey, currentMonthKey, daysInMonth, endOfMonth, formatMonth, monthKey, monthLabel, parseISO, toISO, todayISO } from '../domain/dates';
import { buildScoreFactors } from '../domain/insights';
import { ScoreFactorsCard } from './TipsCard';
import { HelpTip } from '../components/HelpTip';
import { Invoice, buildInvoices, cardUsed, isPending, loanOf, remaining } from '../domain/invoices';
import { formatMoney } from '../domain/money';
import { projectWealth } from '../domain/projection';
import { buildOccurrences, finalBalance, monthOccurrences, monthTotals } from '../domain/transactions';
import { categoryLabel, categoryOf } from '../domain/categories';
import { financialHealth, formatRunway, netWorth, pendingCommitments, runwayMonths, spendQuality } from '../domain/wealth';
import { useStore } from '../store';
import { useCurrentBalance } from '../store/useCurrentBalance';
import { colors as c, glow, radius, spacing, type } from '../theme';
import { CreditCard, Occurrence, Transaction } from '../types';
import type { MobileTab } from '../components/BottomBar';
import { CardsContent } from './CardsSheet';
import { StatementKind, StatementSheet } from './Statements';
import { FormPreset } from './TransactionForm';

type Entry =
  | { kind: 'tx'; date: string; key: string; o: Occurrence }
  | { kind: 'invoice'; date: string; key: string; invoice: Invoice; card: CreditCard };

type Group = 'pending' | 'done';

/** Normalized row of the transactions table. */
interface Row {
  key: string;
  title: string;
  meta: string;
  date: string;
  amount: number;
  sign: '+' | '-';
  color: string;
  icon: keyof typeof Feather.glyphMap;
  done: boolean;
  group: Group;
  category: string;
  /** when the item has a checkbox (confirm/pay) */
  check?: { tone: 'income' | 'expense' | 'primary'; label: string; onPress: () => void };
  /** invoice payments: trash can in place of the checkbox */
  onRemove?: () => void;
  /** nested items (purchases and payments of an invoice) */
  children?: Row[];
  onPress: () => void;
}

interface Props {
  /** mobile: content split into tabs (summary, projection, transactions) and actions in the bottom bar */
  mobile?: boolean;
  mobileTab?: MobileTab;
  month: string;
  onMonthChange: (month: string) => void;
  /** opens the transaction form (with `preset`, already targeted) */
  onAdd: (preset?: FormPreset) => void;
  onEdit: (tx: Transaction, month?: string) => void;
  onPayInvoice: (preset: FormPreset) => void;
  /** opens card management */
  onOpenCards: () => void;
}

/** Short explanations shown by the "?" next to the card titles (the totals explain themselves inside their own dialogs). */
const PROJECTION_HELP = 'Where your accumulated wealth is heading. Planned uses what you already registered; Historical also subtracts your typical one-off spending of the last 3 months.';
const HEALTH_HELP = 'A score from 0 to 1000 made of three parts: Wealth (40%), Debt-free (30%) and Healthy spending (30%).';
const TRANSACTIONS_HELP = 'What you registered for the month. Tick an item when it actually happens: pending items are still expected, confirmed ones are done.';

const HORIZONS = [6, 12, 24] as const;
const GROUPS: { key: Group; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'done', label: 'Confirmed' },
];

/** soft row hover: very light blue background, 150ms transition on web (no scale) */
const hoverBg = (hovered: boolean) =>
  ({ backgroundColor: hovered ? 'rgba(15,27,51,0.03)' : 'transparent', ...(Platform.OS === 'web' ? { transitionProperty: 'background-color', transitionDuration: '150ms' } : null) }) as object;

const shortDate = (iso: string) => {
  const { d, m } = parseISO(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

export function Dashboard({ mobile, mobileTab = 'summary', month, onMonthChange, onAdd, onEdit, onPayInvoice, onOpenCards }: Props) {
  const { data, toggleConfirmed, archivePayment } = useStore();
  const balanceNow = useCurrentBalance();
  const [width, setWidth] = useState(0);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(12);
  const [chartSel, setChartSel] = useState<number | null>(null);
  /** open statement (when tapping a total) */
  const [detail, setDetail] = useState<StatementKind | null>(null);
  /** projection chart series hidden via the legend (0 = Planned, 1 = Historical) */
  const [hiddenSeries, setHiddenSeries] = useState<number[]>([]);
  const toggleSeries = (i: number) => setHiddenSeries((h) => (h.includes(i) ? h.filter((x) => x !== i) : h.length >= 1 ? h : [...h, i]));
  const today = todayISO();
  const wide = width >= 900;
  const { height: winH } = useWindowDimensions();
  /** desktop side column: height of the health card, to give the factors card only what is left of the screen */
  const [healthH, setHealthH] = useState(0);
  const cards = data.cards;

  useEffect(() => setChartSel(null), [horizon]);

  // occurrences only up to the displayed month (future fixed items do not weigh)
  const occ = useMemo(() => {
    const until = monthKey(today) > month ? monthKey(today) : month;
    return buildOccurrences(data, until);
  }, [data, month, today]);

  const calc = useMemo(() => {
    const end = endOfMonth(month);
    const cardById = new Map(data.cards.map((x) => [x.id, x]));
    const list = monthOccurrences(occ, month).filter((o) => !o.cardId);
    const invoices = buildInvoices(data, occ);
    const monthInvoices = invoices.filter((i) => monthKey(i.dueDate) === month);
    const entries: Entry[] = [
      ...list.map((o): Entry => ({ kind: 'tx', date: o.date, key: o.key, o })),
      ...monthInvoices.flatMap((invoice): Entry[] => {
        const card = cardById.get(invoice.cardId);
        return card ? [{ kind: 'invoice', date: invoice.dueDate, key: `inv-${invoice.cardId}-${invoice.key}`, invoice, card }] : [];
      }),
    ].sort((a, b) => a.date.localeCompare(b.date));
    // average monthly expense (last 3 months up to the current month, cards included): basis of the "peace of mind runway"
    let spent = 0;
    for (let k = 0; k < 3; k++) {
      const key = addMonthsToKey(currentMonthKey(), -k);
      spent += monthTotals(monthOccurrences(occ, key).filter((o) => !o.cardId), invoices.filter((i) => monthKey(i.dueDate) === key)).expense;
    }
    // spending quality (last 3 months up to the current month): categories and planning
    const recent = new Set([0, 1, 2].map((k) => addMonthsToKey(currentMonthKey(), -k)));
    const spends = occ
      // loans (other people's money put on your card) are not your spending: excluded from quality
      .filter((o) => o.type === 'expense' && o.category !== 'loan' && recent.has(monthKey(o.purchaseDate)) && (!o.cardId || cardById.has(o.cardId)))
      .map((o) => ({ amount: o.amount, weight: categoryOf(o.category).weight, planned: o.fixed || !!o.installment, category: categoryOf(o.category).slug }));
    const quality = spendQuality(spends);
    // month summary for the table footer. Same rules as `monthTotals` (Refund and Loan are neutral, invoices net of loans)
    const totals = monthTotals(list, monthInvoices);
    let confirmedExpense = 0;
    for (const o of list) {
      if (o.type !== 'expense' || !o.confirmed || o.category === 'refund' || o.category === 'loan') continue;
      confirmedExpense += o.amount;
    }
    for (const inv of monthInvoices) confirmedExpense += Math.min(inv.paid, Math.max(Math.max(inv.total, inv.paid) - loanOf(inv), 0));
    let confirmedIncome = 0;
    for (const o of list) {
      if (o.type !== 'income' || !o.confirmed || o.category === 'refund' || o.category === 'loan') continue;
      confirmedIncome += o.amount;
    }
    // each side (income and expenses) is split into what is confirmed and what is still pending
    const summary = {
      income: { total: totals.income, confirmed: Math.min(confirmedIncome, totals.income), pending: Math.max(totals.income - confirmedIncome, 0) },
      expense: { total: totals.expense, confirmed: Math.min(confirmedExpense, totals.expense), pending: Math.max(totals.expense - confirmedExpense, 0) },
      left: totals.income - totals.expense,
      leftNow: Math.min(confirmedIncome, totals.income) - Math.min(confirmedExpense, totals.expense),
    };
    return {
      entries,
      invoices,
      summary,
      spends,
      final: finalBalance(occ, invoices, end),
      totals,
      avgExpense: Math.round(spent / 3),
      commitments: pendingCommitments(occ, endOfMonth(currentMonthKey())),
      quality,
    };
  }, [data, occ, month]);
  const { final, totals, avgExpense, quality, commitments, summary, spends } = calc;

  // accumulated wealth projection: from the current month onward (only recalculates when data or horizon change)
  const projection = useMemo(() => projectWealth(data, currentMonthKey(), horizon), [data, horizon]);
  // always the full MM/YYYY (never abbreviated); the chart draws the axis labels diagonally
  const chartLabels = projection.keys.map(formatMonth);

  const edit = (o: Occurrence) => {
    const tx = data.transactions.find((x) => x.id === o.transactionId);
    if (tx) onEdit(tx, o.monthKey);
  };

  const rows: Row[] = calc.entries.map((entry): Row => {
    if (entry.kind === 'invoice') {
      const { invoice, card: ic } = entry;
      const left = remaining(invoice);
      const paid = left === 0 && invoice.total > 0;
      const pay = () => onPayInvoice({ kind: 'invoice', cardId: ic.id, invoiceKey: invoice.key });
      // purchases are nested in the invoice (confirmation comes with the payment)
      const children: Row[] = [
        ...[...invoice.items]
          .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.order - b.order)
          .map((o): Row => {
            const income = o.type === 'income';
            return {
              key: `buy-${o.key}`,
              title: o.description,
              meta: [o.installment ? `${o.installment.index}/${o.installment.total}` : null, o.fixed ? (isPending(o, today) ? 'Fixed · expected' : 'Fixed') : null].filter(Boolean).join(' · '),
              date: o.purchaseDate,
              amount: o.amount,
              sign: income ? '+' : '-',
              color: income ? c.income : c.expense,
              icon: income ? 'rotate-ccw' : 'arrow-down-right',
              done: paid,
              group: paid ? 'done' : 'pending',
              category: income ? 'Refund' : categoryLabel(o.category),
              onPress: () => edit(o),
            };
          }),
      ];
      return {
        key: entry.key,
        title: `${ic.name} invoice`,
        meta: [`${invoice.items.length} ${invoice.items.length === 1 ? 'item' : 'items'}`, !paid && invoice.paid > 0 ? `${formatMoney(left)} left` : null].filter(Boolean).join(' · '),
        date: invoice.dueDate,
        amount: Math.max(invoice.total, invoice.paid),
        sign: '-',
        color: c.expense,
        icon: 'credit-card',
        done: paid,
        group: paid ? 'done' : 'pending',
        category: 'Invoice',
        children,
        check: {
          tone: 'expense',
          label: paid ? `Undo payment of ${ic.name} invoice` : `Pay ${ic.name} invoice`,
          // unchecking a paid invoice undoes its payment(s)
          onPress: paid ? () => invoice.payments.forEach((pm) => archivePayment(pm.id)) : pay,
        },
        onPress: paid ? onOpenCards : pay,
      };
    }
    const o = entry.o;
    const income = o.type === 'income';
    return {
      key: entry.key,
      title: o.description,
      // every row carries one badge so the rows look alike: installment (n/total), Fixed or, when it is neither, One-time
      meta: [o.installment ? `${o.installment.index}/${o.installment.total}` : null, o.fixed ? 'Fixed' : null].filter(Boolean).join(' · ') || 'One-time',
      date: o.date,
      amount: o.amount,
      sign: income ? '+' : '-',
      color: income ? c.income : c.expense,
      icon: income ? 'arrow-up-right' : 'arrow-down-right',
      done: o.confirmed,
      group: o.confirmed ? 'done' : 'pending',
      category: categoryLabel(o.category, o.type),
      check: { tone: income ? 'income' : 'expense', label: income ? 'Confirm receipt' : 'Confirm payment', onPress: () => toggleConfirmed(o.transactionId, o.monthKey) },
      onPress: () => edit(o),
    };
  });

  const allGroups = GROUPS.map((g) => ({ ...g, list: rows.filter((r) => r.group === g.key) })).filter((g) => g.list.length > 0);
  /** single group: no label and normal opacity */
  const single = allGroups.length === 1;
  const visibleGroups = allGroups;

  // ---- focus: accumulate as much as possible; cards are debt ----
  const usedByCard = cards.map((x) => cardUsed(calc.invoices, x.id, today));
  const debtTotal = usedByCard.reduce((sum, v) => sum + v, 0);
  const worth = netWorth(balanceNow, debtTotal, commitments);
  const runway = runwayMonths(worth, avgExpense);
  const runwayText = runway === null ? null : formatRunway(runway);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  let rowSeq = 0;

  /** table row; `nested` = item inside an invoice: minimal, text only (no icon or pill) */
  const renderRow = (r: Row, border: boolean, dim: boolean, nested: boolean) => {
    if (nested) {
      return (
        <Pressable key={r.key} accessible={false} focusable={false} style={({ hovered }: any) => [s.nestedRow, hoverBg(hovered), dim && { opacity: 0.6 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${r.title}`} onPress={r.onPress} style={({ pressed }: any) => [s.nestedMain, { opacity: pressed ? 0.6 : 1 }]}>
            {/* same columns as the parent row: the text starts at the same point as the invoice title */}
            <View style={{ flex: wide ? 3 : 1, minWidth: 0 }}>
              <View style={{ marginLeft: wide ? 52 : 16 }}>
                <Text style={[type.body, { color: c.text }]} numberOfLines={wide ? 1 : undefined}>{r.title}{r.meta ? <Text style={{ color: c.textMuted }}>{`  ${r.meta}`}</Text> : null}</Text>
                {!wide && <Text style={[type.body, { color: c.textMuted }]}>{[shortDate(r.date), r.category].join(' · ')}</Text>}
              </View>
            </View>
            {wide && <Text style={[type.body, { color: c.textMuted, flex: 1.2 }]}>{shortDate(r.date)}</Text>}
            {wide && (
              <View style={{ flex: 1.5, alignItems: 'flex-start' }}>
                <CategoryPill label={r.category} />
              </View>
            )}
            <Text style={[type.body, { color: c.textMuted, flex: wide ? 1.5 : undefined, flexShrink: 0, textAlign: 'right' }]} numberOfLines={wide ? 1 : undefined}>
              {r.sign} {formatMoney(r.amount)}
            </Text>
          </Pressable>
          {r.onRemove ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Archive payment" onPress={r.onRemove} style={s.trash}>
              <Feather name="trash-2" size={18} color={c.textMuted} />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </Pressable>
      );
    }
    return (
      // the hover covers the WHOLE row (content, checkbox and delete button), not just the clickable part
      <Pressable key={r.key} accessible={false} focusable={false} style={({ hovered }: any) => [s.txRow, !wide && s.txRowMobile, border && { borderTopWidth: 1, borderColor: c.border }, hoverBg(hovered), dim && { opacity: 0.6 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${r.title}`} onPress={r.onPress} style={({ pressed }: any) => [s.txMain, !wide && s.txMainMobile, { opacity: pressed ? 0.6 : 1 }]}>
          <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0 }}>
            <View style={[s.tile, { backgroundColor: `${r.color}1A` }]}>
              <Feather name={r.icon} size={18} color={r.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: c.text }]} numberOfLines={wide ? 1 : undefined}>{r.title}</Text>
              {!wide && <Text style={[type.body, { color: c.textMuted, marginTop: 2 }]}>{[shortDate(r.date), r.category].join(' · ')}</Text>}
              {wide && <MetaPills meta={r.meta} />}
            </View>
          </View>
          {wide && <Text style={[type.body, { color: c.text, flex: 1.2 }]}>{shortDate(r.date)}</Text>}
          {wide && (
            <View style={{ flex: 1.5, alignItems: 'flex-start' }}>
              <CategoryPill label={r.category} />
            </View>
          )}
          {wide ? (
            <Text style={[type.label, { color: r.sign === '+' ? c.income : c.text, flex: 1.5, flexShrink: 0, textAlign: 'right' }]} numberOfLines={1}>
              {r.sign} {formatMoney(r.amount)}
            </Text>
          ) : (
            // phone: two balanced columns: title and date on the left, amount and badge on the right
            <View style={{ alignItems: 'flex-end', gap: spacing.xs, flexShrink: 0 }}>
              <Text style={[type.label, { color: r.sign === '+' ? c.income : c.text, textAlign: 'right' }]}>{r.sign} {formatMoney(r.amount)}</Text>
              <MetaPills meta={r.meta} end />
            </View>
          )}
        </Pressable>
        {r.onRemove ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Archive payment" onPress={r.onRemove} style={s.trash}>
            <Feather name="trash-2" size={20} color={c.expense} />
          </Pressable>
        ) : r.check ? (
          <CheckButton checked={r.done} tone={r.check.tone} label={r.check.label} onPress={r.check.onPress} />
        ) : (
          <View style={{ width: 44 }} />
        )}
      </Pressable>
    );
  };

  const table = (
    // overflow visible: a clipping card would break the sticky header; the rounded corners are drawn by the header and the body
    <Card padded={false} style={{ overflow: 'visible' }}>
      {/* sticky on the web: the title, the month filter and the column titles follow the page scroll */}
      <View style={s.stickyHead}>
      {mobile ? (
        // mobile: title and month selector centered (the + is in the bottom bar)
        <View style={{ alignItems: 'center', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.md }}>
          <View style={s.titleRow}>
            <Text style={[type.title, { color: c.text }]} numberOfLines={1}>Transactions</Text>
            <HelpTip title="Transactions" text={TRANSACTIONS_HELP} />
          </View>
          <MonthNav month={month} onChange={onMonthChange} />
        </View>
      ) : (
        <View style={[s.tableHead, { padding: spacing.xl - 4, paddingBottom: spacing.md }]}>
          <View style={s.headSide}>
            <View style={s.titleRow}>
              <Text style={[type.title, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>Transactions</Text>
              <HelpTip title="Transactions" text={TRANSACTIONS_HELP} />
            </View>
          </View>
          <MonthNav month={month} onChange={onMonthChange} />
          <View style={[s.headSide, { alignItems: 'flex-end' }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New transaction"
              onPress={() => onAdd()}
              style={({ pressed, hovered }: any) => [s.addBtn, glow(c.primary, 12, 0.5), { backgroundColor: hovered ? '#2447BD' : c.primary, opacity: pressed ? 0.85 : 1 }, Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '160ms' } as object)]}
            >
              <Feather name="plus" size={24} color={c.onPrimary} />
            </Pressable>
          </View>
        </View>
      )}
      {wide && visibleGroups.length > 0 && (
        <View style={[s.txRow, s.headRow, { borderColor: c.border }]}>
          <View style={[s.txMain, { minHeight: 36 }]}>
            <Text style={[type.body, { color: c.textMuted, flex: 3 }]}>Description</Text>
            <Text style={[type.body, { color: c.textMuted, flex: 1.2 }]}>Date</Text>
            <Text style={[type.body, { color: c.textMuted, flex: 1.5 }]}>Category</Text>
            <Text style={[type.body, { color: c.textMuted, flex: 1.5, textAlign: 'right' }]}>Amount</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
      )}
      </View>
      {/* the summary below draws the card's bottom corners when it exists; the empty state draws them itself */}
      <View style={[s.tableBody, visibleGroups.length === 0 && s.tableBodyEnd]}>
      {visibleGroups.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyArt}>
            <Feather name="inbox" size={28} color={c.primary} />
          </View>
          <Text style={[type.title, { color: c.text }]}>A quiet month here</Text>
          <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>Nothing in {monthLabel(month)}. Tap + to add a transaction.</Text>
        </View>
      ) : (
        <View key={month}>
            {visibleGroups.map((g) => (
              <View key={g.key}>
                {!single && (
                  <View style={s.groupLabel}>
                    <Text style={[type.body, { color: c.textMuted, fontWeight: '600', letterSpacing: 0.3 }]}>{g.label}</Text>
                    <View style={s.groupLine} />
                  </View>
                )}
                {g.list.map((r, i) => (
                  // staggered row entrance (first ones only; the rest appear together)
                  <Reveal key={r.key} index={Math.min(rowSeq++, 12) + 1} distance={8} duration={240}>
                    {renderRow(r, i > 0, g.key === 'done' && !single, false)}
                    {r.children && r.children.map((ch) => renderRow(ch, true, g.key === 'done' && !single, true))}
                  </Reveal>
                ))}
              </View>
            ))}
        </View>
      )}
      </View>
      {visibleGroups.length > 0 && (
        // month summary, inside the card: ledger-style lines whose values line up under the Amount column,
        // closed by the "left over" line as the total
        <View style={[s.summary, { borderTopColor: c.border }, mobile && s.summaryMobile]}>
          {mobile ? (
            // phone: Income and Expenses share one quiet row, each a small column; the totals line stays below
            <View style={s.summaryPair}>
              {[
                { label: 'Income', part: summary.income, color: c.income, help: 'Everything you earn this month. Confirmed already came in; pending is still expected. Refunds and loans are not counted.' },
                { label: 'Expenses', part: summary.expense, color: c.expense, help: "All of this month's expenses, card invoices due this month included. Confirmed already happened; pending is still to pay." },
              ].map((x) => (
                <View key={x.label} style={s.summaryCol}>
                  <View style={s.titleRow}>
                    <Text style={[type.body, { color: c.textMuted, flexShrink: 1 }]} numberOfLines={1}>{x.label}</Text>
                    <HelpTip title={x.label} text={x.help} />
                  </View>
                  <Text style={[type.label, { color: x.color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{formatMoney(x.part.total)}</Text>
                  <View style={s.splitBar}>
                    {x.part.total > 0 && (
                      <>
                        <View style={{ flex: x.part.confirmed, backgroundColor: x.color }} />
                        <View style={{ flex: x.part.pending, backgroundColor: x.color, opacity: 0.3 }} />
                      </>
                    )}
                  </View>
                  {/* confirmed and pending: a check and a clock, then the amount (no words, to keep it short) */}
                  <View style={s.splitItem}>
                    <Feather name="check" size={14} color={c.textMuted} />
                    <Text style={[type.body, { color: c.text }]} numberOfLines={1}>{formatMoney(x.part.confirmed)}</Text>
                  </View>
                  <View style={s.splitItem}>
                    <Feather name="clock" size={14} color={c.textMuted} />
                    <Text style={[type.body, { color: c.text }]} numberOfLines={1}>{formatMoney(x.part.pending)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <>
          {[
            { label: 'Income', sign: '+', part: summary.income, color: c.income, help: 'Everything you earn this month. Confirmed already came in; pending is still expected. Refunds and loans are not counted.' },
            { label: 'Expenses', sign: '-', part: summary.expense, color: c.expense, help: "All of this month's expenses, card invoices due this month included. Confirmed already happened; pending is still to pay." },
          ].map((x) => (
            <View key={x.label} style={[s.txRow, s.summaryRow]}>
              {/* the line (label and total), a bar with the confirmed/pending proportion and the two amounts */}
              <View style={[s.txMain, s.summaryMain]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[s.titleRow, { flex: wide ? 5.7 : 1 }]}>
                    <Text style={[type.body, { color: c.textMuted, flexShrink: 1 }]} numberOfLines={1}>{x.label}</Text>
                    <HelpTip title={x.label} text={x.help} />
                  </View>
                  <Text style={[type.label, { color: x.color, flex: wide ? 1.5 : undefined, textAlign: 'right' }]} numberOfLines={1}>{x.sign} {formatMoney(x.part.total)}</Text>
                </View>
                <View style={s.splitBar}>
                  {x.part.total > 0 && (
                    <>
                      <View style={{ flex: x.part.confirmed, backgroundColor: x.color }} />
                      <View style={{ flex: x.part.pending, backgroundColor: x.color, opacity: 0.3 }} />
                    </>
                  )}
                </View>
                <View style={s.splitLegend}>
                  <View style={s.splitItem}>
                    <Text style={[type.body, { color: c.textMuted }]}>Confirmed</Text>
                    <Text style={[type.body, { color: c.text, fontWeight: '600' }]}>{formatMoney(x.part.confirmed)}</Text>
                  </View>
                  <View style={s.splitItem}>
                    <Text style={[type.body, { color: c.textMuted }]}>Pending</Text>
                    <Text style={[type.body, { color: c.text, fontWeight: '600' }]}>{formatMoney(x.part.pending)}</Text>
                  </View>
                </View>
              </View>
              <View style={{ width: 44 }} />
            </View>
          ))}
            </>
          )}
          {[
            { label: mobile ? 'Left over now' : 'Left over so far', value: summary.leftNow, help: "Confirmed income minus confirmed expenses: what you actually have left from this month right now." },
            { label: mobile ? 'Expected left over' : 'Expected left over this month', value: summary.left, help: "Income minus all of the month's expenses, confirmed or pending. It is what goes into your accumulated wealth once everything happens." },
          ].map((x, i) => (
            <View key={x.label} style={[s.txRow, i === 0 && s.summaryTotal, { borderTopColor: c.border }]}>
              <View style={[s.txMain, { minHeight: mobile ? 48 : 60 }]}>
                <View style={[s.titleRow, { flex: wide ? 5.7 : 1 }]}>
                  <Text style={[type.label, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>{x.label}</Text>
                  <HelpTip title={x.label} text={x.help} />
                </View>
                <Text style={[type.title, { color: x.value < 0 ? c.expense : c.primary, fontSize: 22, flex: wide ? 1.5 : undefined, textAlign: 'right' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {formatMoney(x.value)}
                </Text>
              </View>
              <View style={{ width: 44 }} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );

  // no data yet: start from the best (full score and full bars), so it begins with a good feeling
  const health = financialHealth(runway, debtTotal, avgExpense, quality) ?? { score: 1000, saved: 40, debt: 30, habits: 30, label: 'Excellent' };
  const healthColor = health.score < 250 ? c.expense : health.score < 500 ? c.warning : c.primary;
  const factors = [
    { label: 'Wealth', v: health.saved / 40 },
    { label: 'Debt-free', v: health.debt / 30 },
    { label: 'Healthy spending', v: health.habits / 30 },
  ];
  // what makes up the score (pulling it down / pushing it up), from the same numbers the score uses
  const activeCards = cards.filter((x) => !x.archivedAt);
  const factorsList = buildScoreFactors({
    health,
    runway,
    debt: debtTotal,
    avgExpense,
    accumulated: balanceNow,
    commitments,
    spends,
    monthLeft: summary.left,
    cardLimit: activeCards.reduce((sum, x) => sum + x.limit, 0),
    cardUsed: activeCards.reduce((sum, x) => sum + (usedByCard[cards.indexOf(x)] ?? 0), 0),
  });

  const healthCard = (
    <Card key="health">
      <View style={s.statHead}>
        <View style={[s.statTile, { backgroundColor: c.surface }]}>
          <Feather name="heart" size={22} color={c.primary} />
        </View>
        <View style={[s.titleRow, { flex: 1 }]}>
          <Text style={[type.title, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>Financial health</Text>
          <HelpTip title="Financial health" text={HEALTH_HELP} />
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Gauge segments={[{ value: Math.max(health.score, 1), color: healthColor }]} total={1000} size={220} gradient={health.score < 250 ? ['#F28BA3', '#E0446A'] : health.score < 500 ? ['#F5C16B', '#D9831F'] : ['#6F8FF5', '#2D55D9']}>
          <Counter value={health.score} style={[type.hero, { color: healthColor, lineHeight: 42 }]} />
          <Text style={[type.label, { color: healthColor }]}>{health.label}</Text>
        </Gauge>
      </View>
      {factors.map((f) => (
        <View key={f.label} style={s.factor}>
          <Text style={[type.body, { color: c.textMuted, width: 150 }]} numberOfLines={1}>{f.label}</Text>
          <AnimatedBar ratio={f.v} color={f.v < 0.34 ? c.expense : f.v < 0.67 ? c.warning : c.primary} />
        </View>
      ))}
    </Card>
  );

  // phone: collapsed into one line that opens a dialog (the Summary tab stays short)
  const tipsCard = <ScoreFactorsCard factors={factorsList} collapsed />;

  // order: health, card debt, wealth figures and, last, financial freedom
  const debtCard = (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel="View statement: Card debt" onPress={() => setDetail('debt')} style={{ gap: spacing.md }}>
        <View style={s.statHead}>
          <View style={[s.statTile, { backgroundColor: 'rgba(224,68,107,0.12)' }]}>
            <Feather name="credit-card" size={22} color={c.expense} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>Card debt</Text>
            <Money cents={debtTotal} style={[type.title, { color: debtTotal > 0 ? c.expense : c.text, fontSize: 24 }]} numberOfLines={1} />
          </View>
          <Feather name="chevron-right" size={20} color={c.textMuted} />
        </View>
      </Pressable>
    </Card>
  );
  // pending account commitments (excluding the card, which has its own card): accumulated - debt - commitments = net
  const commitmentsCard = <StatCard icon="clock" label="Pending commitments" cents={commitments} onPress={() => setDetail('commitments')} accent={c.warning} valueColor={commitments > 0 ? c.warning : c.text} />;
  const figureEls = [
    <StatCard key="s1" icon="trending-up" label="Accumulated wealth" cents={balanceNow} onPress={() => setDetail('accumulated')} accent={c.primary} valueColor={balanceNow < 0 ? c.expense : c.primary} />,
    debtCard,
    commitmentsCard,
    <StatCard key="s2" icon="award" label="Net worth" cents={worth} onPress={() => setDetail('net')} accent={c.violet} valueColor={worth < 0 ? c.expense : c.violet} />,
    <StatCard key="s0" icon="sun" label="Financial freedom" value={runwayText ?? '—'} onPress={() => setDetail('freedom')} accent={runway !== null && runway < 3 ? c.expense : c.sky} valueColor={runway === null ? c.text : runway < 3 ? c.expense : c.sky} />,
  ];
  // phone (Summary tab): health, its tips, then the figures; desktop splits them (see below)
  const items = [healthCard, tipsCard, ...figureEls];
  const stats = items.map((el, i) => (
    <Reveal key={i} index={i + 1}>
      {el}
    </Reveal>
  ));

  // desktop: the health card goes alone in a sticky side column; the five figures sit under the chart in a
  // 2-column grid (the last one takes the full row)
  const figures = figureEls;
  const figureGrid = (
    <View style={s.figureGrid}>
      {figures.map((el, i) => (
        <View key={i} style={[s.figureCell, i === figures.length - 1 && figures.length % 2 === 1 && { flexBasis: '100%' }]}>
          <Reveal index={i + 2}>{el}</Reveal>
        </View>
      ))}
    </View>
  );

  const chartCard = (
    <Card>
      {mobile ? (
        <View style={{ gap: spacing.md, alignItems: 'center' }}>
          <View style={s.titleRow}>
            <Text style={[type.title, { color: c.text }]}>Wealth projection</Text>
            <HelpTip title="Wealth projection" text={PROJECTION_HELP} />
          </View>
          <View style={{ alignSelf: 'stretch' }}>
            <PillToggle stretch value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: `${h} months` }))} />
          </View>
        </View>
      ) : (
        <View style={[s.rowBetween, { gap: spacing.md, flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <View style={s.titleRow}>
              <Text style={[type.title, { color: c.text }]}>Wealth projection</Text>
              <HelpTip title="Wealth projection" text={PROJECTION_HELP} />
            </View>
          </View>
          <PillToggle value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: `${h} months` }))} />
        </View>
      )}
      <ProjectionChart
        series={[
          { values: projection.planned, color: c.primary, area: true, label: 'Planned' },
          { values: projection.habit, color: c.expense, dashed: true, label: 'Historical' },
        ].filter((_, i) => !hiddenSeries.includes(i))}
        labels={chartLabels}
        selected={chartSel === null ? null : Math.min(chartSel, projection.keys.length - 1)}
        onSelect={setChartSel}
      />
      <ChartLegend
        items={[
          { label: 'Planned', color: c.primary, line: true, on: !hiddenSeries.includes(0), onPress: () => toggleSeries(0) },
          { label: 'Historical', color: c.expense, line: true, dashed: true, on: !hiddenSeries.includes(1), onPress: () => toggleSeries(1) },
        ]}
      />
    </Card>
  );

  const statementCtx = {
    occ,
    invoices: calc.invoices,
    payments: data.payments,
    cards,
    balance: balanceNow,
    debt: debtTotal,
    commitments,
    worth,
    avgExpense,
    runway,
    today,
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {mobile ? (
        // one tab at a time, full width; switching tabs restarts the entrance animation
        <View key={mobileTab} style={{ gap: spacing.md }}>
          {mobileTab === 'summary' && stats}
          {mobileTab === 'projection' && <Reveal>{chartCard}</Reveal>}
          {mobileTab === 'transactions' && <Reveal>{table}</Reveal>}
          {mobileTab === 'cards' && (
            <Reveal>
              <Card>
                <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>Cards</Text>
                <CardsContent />
              </Card>
            </Reveal>
          )}
        </View>
      ) : wide ? (
        <View style={s.cols}>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.lg }}>
            <InstallCard />
            <Reveal index={1}>{chartCard}</Reveal>
            {figureGrid}
            <Reveal index={3}>{table}</Reveal>
          </View>
          {/* sticky: the health card follows the page while the rest scrolls */}
          <View style={s.sideSticky}>
            <Reveal index={1} style={{ flexShrink: 0 }}><View onLayout={(e) => setHealthH(e.nativeEvent.layout.height)}>{healthCard}</View></Reveal>
            {/* only the factors card scrolls (inside itself), and only when the screen is too short for both */}
            <Reveal index={2} style={{ flexShrink: 1, minHeight: 0, ...(healthH > 0 ? { maxHeight: Math.max(160, winH - 61 - spacing.lg * 3 - healthH) } : null) }}><ScoreFactorsCard factors={factorsList} scroll /></Reveal>
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Reveal index={1}>{chartCard}</Reveal>
          <Reveal index={2}>{table}</Reveal>
          <View style={{ gap: spacing.md }}>{stats}</View>
        </View>
      )}
      <StatementSheet kind={detail} ctx={statementCtx} onClose={() => setDetail(null)} />
    </View>
  );
}

/** Recurrence tags (Fixed, 1/2, Reserve...) as discreet pills. */
function MetaPills({ meta, end }: { meta: string; end?: boolean }) {
  const tags = meta.split(' · ').filter(Boolean);
  if (tags.length === 0) return null;
  return (
    <View style={[s.pillRow, end && { justifyContent: 'flex-end', marginTop: 0 }]}>
      {tags.map((tag) => (
        <View key={tag} style={s.metaPill}>
          <Text style={[type.body, { color: c.textMuted, fontSize: 16 }]}>{tag}</Text>
        </View>
      ))}
    </View>
  );
}

function CategoryPill({ label }: { label: string }) {
  return (
    <View style={s.status}>
      <Text style={[type.body, { color: c.textMuted, fontWeight: '600' }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Indicator card: icon in a square, label and value. Fixed structure, same size, no extra text. */
function StatCard({ icon, label, value, cents, valueColor, accent, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; value?: string; /** value in cents that counts up to the new value */ cents?: number; valueColor?: string; /** icon and icon square color */ accent?: string; /** opens the value's statement */ onPress?: () => void }) {
  const body = (
      <View style={s.statHead}>
        <View style={[s.statTile, { backgroundColor: accent ? `${accent}1F` : c.surface }]}>
          <Feather name={icon} size={22} color={accent ?? c.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{label}</Text>
          {cents !== undefined ? (
            <Money cents={cents} style={[type.title, { color: valueColor ?? c.text, fontSize: 24 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} />
          ) : (
            <Text style={[type.title, { color: valueColor ?? c.text, fontSize: 24 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
          )}
        </View>
        {onPress && <Feather name="chevron-right" size={20} color={c.textMuted} />}
      </View>
  );
  return (
    // no hover state on the indicator cards (all alike, clickable or not); only the press feedback
    <Card>
      {onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`View statement: ${label}`} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  cols: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  /** card title followed by its "?" */
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0 },
  /** health + tips: pinned while the page scrolls; the column itself never scrolls (the tips card does, if needed) */
  sideSticky: { width: 340, gap: spacing.lg, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: spacing.lg, maxHeight: 'calc(100vh - 93px)' } as object) : null) },
  figureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  figureCell: { flexGrow: 1, flexBasis: '45%', minWidth: 260 },
  /** title on the left, month selector centered, + on the right */
  tableHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md },
  headSide: { flex: 1, minWidth: 120 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tile: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statTile: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  factor: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  status: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4, backgroundColor: c.surface, maxWidth: '100%' },
  headRow: { borderTopWidth: 1, borderBottomWidth: 0 },
  /** sticks to the bottom of the screen on the web; solid white so the rows pass beneath it, rounded bottom corners (the card does not clip) */
  summary: { borderTopWidth: 1, paddingTop: spacing.xs, backgroundColor: c.card, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card, overflow: 'hidden', ...(Platform.OS === 'web' ? ({ position: 'sticky', bottom: 0, zIndex: 4 } as object) : null) },
  /** phone: stays above the docked bottom bar */
  summaryMobile: { ...(Platform.OS === 'web' ? ({ bottom: 'calc(61px + env(safe-area-inset-bottom))' } as object) : null) },
  /** phone: Income and Expenses side by side, small columns */
  summaryPair: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.xl - 4, paddingTop: spacing.md, paddingBottom: spacing.sm },
  summaryCol: { flex: 1, minWidth: 0, gap: 4 },
  summaryRow: { minHeight: 40 },
  /** Income / Expenses block: line, proportion bar and the two amounts stacked */
  summaryMain: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 6, paddingVertical: spacing.md },
  splitBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: c.surface },
  splitLegend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 2 },
  splitItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  /** the total line: same white as the rest of the card, set apart by a hairline and bigger type (no different background) */
  summaryTotal: { borderTopWidth: 1, minHeight: 60 },
  /** web: sticks under the fixed top bar while the page scrolls; solid white so rows pass beneath it */
  stickyHead: { backgroundColor: c.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, borderBottomWidth: 1, borderBottomColor: c.border, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 0, zIndex: 5 } as object) : null) },
  tableBody: { overflow: 'hidden' },
  tableBodyEnd: { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
  groupLabel: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.lg, paddingBottom: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  metaPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: 'rgba(15,27,51,0.06)' },
  groupLine: { flex: 1, height: 1, backgroundColor: c.border },
  /** nested invoice items: text only, indented and borderless */
  nestedRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xl - 4, paddingRight: spacing.sm, minHeight: 68 },
  nestedMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68 },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xl - 4, paddingRight: spacing.sm, minHeight: 68 },
  txMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68 },
  /** phone: more air (taller row, wider gaps, a bit more room before the checkbox) */
  txRowMobile: { paddingVertical: spacing.xs, paddingRight: spacing.md },
  txMainMobile: { minHeight: 80, gap: spacing.lg },
  addBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  trash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  emptyArt: { width: 64, height: 64, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, backgroundColor: c.surface },
});
