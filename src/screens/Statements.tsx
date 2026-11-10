import { Feather } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BarChart, ChartLegend } from '../components/Charts';
import { Segmented } from '../components/Controls';
import { t, usePrefsVersion } from '../i18n';
import { Sheet } from '../components/Sheet';
import { AnimatedBar } from '../components/Motion';
import { cardColor } from '../domain/cards';
import { categoryLabel } from '../domain/categories';
import { addMonthsToKey, currentMonthKey, endOfMonth, monthLabel, monthName, parseISO } from '../domain/dates';
import { Invoice } from '../domain/invoices';
import { formatMoney } from '../domain/money';
import { debtBreakdown, debtTimeline, monthlyLeftovers } from '../domain/statements';
import { commitmentItems, formatRunway, runwayPlan } from '../domain/wealth';
import { colors as c, radius, spacing, type } from '../theme';
import { CreditCard, InvoicePayment, Occurrence } from '../types';

export type StatementKind = 'accumulated' | 'debt' | 'commitments' | 'net' | 'freedom';

export interface StatementContext {
  occ: Occurrence[];
  invoices: Invoice[];
  payments: InvoicePayment[];
  cards: CreditCard[];
  balance: number;
  debt: number;
  commitments: number;
  worth: number;
  avgExpense: number;
  runway: number | null;
  today: string;
}

const TITLES: Record<StatementKind, string> = {
  accumulated: 'Accumulated wealth',
  debt: 'Card debt',
  commitments: 'Pending commitments',
  net: 'Net worth',
  freedom: 'Financial freedom',
};

/** One or two short sentences under the dialog title: what the figure represents. */
const DESCRIPTIONS: Record<StatementKind, string> = {
  accumulated: "Everything you have accumulated: each month's amount added up.",
  debt: 'What you still owe on your credit cards. A card is debt, not extra income.',
  commitments: 'Bills and installments already registered that you have not paid yet (cards aside).',
  net: 'Accumulated wealth minus card debt and pending commitments: what is really yours.',
  freedom: 'How many months your net worth would cover your average expenses if you stopped working today.',
};

const dm = (iso: string) => {
  const { d, m } = parseISO(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

const tone = (v: number) => (v < 0 ? c.expense : c.text);

/** Statement for each total: where the value comes from. */
export function StatementSheet({ kind, ctx, onClose }: { kind: StatementKind | null; ctx: StatementContext; onClose: () => void }) {
  const currentKey = currentMonthKey();
  // keep the last kind mounted while the dialog closes, so it can play its exit animation
  const last = useRef<StatementKind | null>(kind);
  if (kind) last.current = kind;
  const shown = last.current;
  const visible = kind !== null;
  if (!shown) return null;
  switch (shown) {
    case 'accumulated':
      return <Accumulated ctx={ctx} visible={visible} onClose={onClose} />;
    case 'debt':
      return <Debt ctx={ctx} visible={visible} onClose={onClose} />;
    case 'commitments':
      return <Commitments ctx={ctx} visible={visible} onClose={onClose} />;
    case 'net':
      return <Net ctx={ctx} visible={visible} onClose={onClose} />;
    case 'freedom':
      return <Freedom ctx={ctx} startKey={currentKey} visible={visible} onClose={onClose} />;
  }
}

/** Props every statement dialog gets. */
interface SheetProps {
  ctx: StatementContext;
  visible: boolean;
  onClose: () => void;
}

/** The short explanation under the dialog title (fixed, with the total and the tabs). */
const Desc = ({ kind }: { kind: StatementKind }) => <Text style={[type.body, { color: c.textMuted }]}>{t(DESCRIPTIONS[kind])}</Text>;

function Total({ label, value, color, big }: { label?: string; value: string; color: string; big?: boolean }) {
  return (
    <View style={s.total}>
      {label ? <Text style={[type.body, { color: c.textMuted }]}>{label}</Text> : null}
      <Text style={[type.hero, { color, fontSize: big ? 52 : 36, lineHeight: big ? 60 : 42, letterSpacing: big ? -0.5 : 0 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
    </View>
  );
}

function Line({ label, value, color = c.text, muted, strong, indent, strike }: { label: string; value: string; color?: string; muted?: boolean; strong?: boolean; indent?: boolean; /** struck through: shown, but not counted */ strike?: boolean }) {
  return (
    <View style={[s.line, indent && { paddingLeft: spacing.lg }]}>
      <Text style={[type.body, { color: muted ? c.textMuted : c.text, flex: 1, fontWeight: strong ? '700' : '400' }, strike && s.strike]} numberOfLines={2}>{label}</Text>
      <Text style={[type.body, { color, fontWeight: strong ? '700' : '400' }, strike && s.strike]}>{value}</Text>
    </View>
  );
}

const Note = ({ children }: { children: string }) => <Text style={[type.body, { color: c.textMuted }]}>{children}</Text>;
const Empty = ({ children }: { children: string }) => <Text style={[type.body, { color: c.textMuted, paddingVertical: spacing.md }]}>{children}</Text>;

/** The leftovers of every month that make up the wealth, from newest to oldest. */
function Leftovers({ ctx }: { ctx: StatementContext }) {
  const months = useMemo(() => monthlyLeftovers(ctx.occ, ctx.payments, endOfMonth(currentMonthKey())).reverse(), [ctx.occ, ctx.payments]);
  if (months.length === 0) return <Empty>{t('No confirmed amounts yet.')}</Empty>;
  return (
    <View style={s.table}>
      <View style={[s.line, s.head]}>
        <Text style={[type.body, { color: c.textMuted, flex: 1.2 }]}>{t('Month')}</Text>
        <Text style={[type.body, { color: c.textMuted, flex: 1, textAlign: 'right' }]}>{t('Left over')}</Text>
        <Text style={[type.body, { color: c.textMuted, flex: 1.2, textAlign: 'right' }]}>{t('Accumulated')}</Text>
      </View>
      {months.map((m) => (
        <View key={m.key} style={[s.line, s.rowBorder]}>
          <Text style={[type.body, { color: c.text, flex: 1.2 }]} numberOfLines={1}>{monthLabel(m.key)}</Text>
          <Text style={[type.body, { color: m.net < 0 ? c.expense : m.net > 0 ? c.primary : c.textMuted, flex: 1, textAlign: 'right' }]} numberOfLines={1}>{m.net > 0 ? '+ ' : m.net < 0 ? '- ' : ''}{formatMoney(Math.abs(m.net))}</Text>
          <Text style={[type.body, { color: tone(m.running), flex: 1.2, textAlign: 'right', fontWeight: '600' }]} numberOfLines={1}>{formatMoney(m.running)}</Text>
        </View>
      ))}
    </View>
  );
}

function Accumulated({ ctx, visible, onClose }: SheetProps) {
  const [tab, setTab] = useState<'details' | 'chart'>('chart');
  // evolution: accumulated wealth at the end of each month (last 12 months with activity up to the current month)
  const months = useMemo(() => monthlyLeftovers(ctx.occ, ctx.payments, endOfMonth(currentMonthKey())).slice(-12), [ctx.occ, ctx.payments]);
  const bars = months.map((m, i) => {
    const mi = Number(m.key.slice(5, 7)) - 1;
    return { label: `${shortMonth(mi)}${mi === 0 || i === 0 ? ` ${m.key.slice(2, 4)}` : ''}`, segments: [{ value: m.running, color: m.running < 0 ? c.expense : c.primary }] };
  });
  return (
    <Sheet
      visible={visible}
      title={t(TITLES.accumulated)}
      onClose={onClose}
      fixed={
        <>
          <Desc kind="accumulated" />
          <Total value={formatMoney(ctx.balance)} color={ctx.balance < 0 ? c.expense : c.primary} />
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chart' as const, label: t('Evolution') },
              { value: 'details' as const, label: t('Details') },
            ]}
          />
        </>
      }
    >
      {tab === 'chart' ? (
        months.length === 0 ? <Empty>{t('No confirmed amounts yet.')}</Empty> : <BarChart groups={bars} />
      ) : (
        <>
          <Leftovers ctx={ctx} />
        </>
      )}
    </Sheet>
  );
}

function Net({ ctx, visible, onClose }: SheetProps) {
  return (
    <Sheet
      visible={visible}
      title={t(TITLES.net)}
      onClose={onClose}
      fixed={
        <>
          <Desc kind="net" />
          <Total value={formatMoney(ctx.worth)} color={ctx.worth < 0 ? c.expense : c.violet} />
        </>
      }
    >
      <View style={s.table}>
        <Line label={t('Accumulated wealth')} value={formatMoney(ctx.balance)} color={c.primary} />
        <Line label={t('Card debt')} value={`- ${formatMoney(ctx.debt)}`} color={c.expense} />
        <Line label={t('Pending commitments')} value={`- ${formatMoney(ctx.commitments)}`} color={c.warning} />
        <View style={s.sum} />
        <Line label={t('Net worth')} value={formatMoney(ctx.worth)} color={ctx.worth < 0 ? c.expense : c.violet} strong />
      </View>
    </Sheet>
  );
}

/** the first letters of the month name in the current language */
const shortMonth = (mi: number) => monthName(mi + 1).slice(0, 3);

function Debt({ ctx, visible, onClose }: SheetProps) {
  const [tab, setTab] = useState<'details' | 'chart'>('chart');
  /** cards hidden in the chart legend (at least one always stays) */
  const [hidden, setHidden] = useState<string[]>([]);
  const toggleCard = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : h.length >= ctx.cards.length - 1 ? h : [...h, id]));
  const groups = useMemo(() => debtBreakdown(ctx.invoices, ctx.cards, ctx.today), [ctx.invoices, ctx.cards, ctx.today]);
  // evolution: the value of each invoice per month (by invoice), stacked by card, from 6 months back to 6 ahead.
  // Already paid ones also appear, normal and per card (they do not count toward the debt total). Past months without an invoice are skipped;
  // the current and future months appear even when empty.
  const bars = useMemo(() => {
    const now = ctx.today.slice(0, 7);
    const timeline = debtTimeline(ctx.invoices, ctx.cards, ctx.today);
    const out: { label: string; segments: { value: number; color: string; paid?: boolean }[] }[] = [];
    for (let k = addMonthsToKey(now, -6); k <= addMonthsToKey(now, 6); k = addMonthsToKey(k, 1)) {
      const slices = (timeline.get(k) ?? []).filter((x) => !hidden.includes(x.card.id));
      if (k < now && slices.length === 0) continue;
      // per card: the paid part (lighter, with ✓) and the open part, stacked in the card color
      const segments = slices.flatMap((x) => {
        const color = cardColor(x.card, ctx.cards.findIndex((cd) => cd.id === x.card.id));
        return [...(x.settled > 0 ? [{ value: x.settled, color, paid: true }] : []), ...(x.debt > 0 ? [{ value: x.debt, color }] : [])];
      });
      const mi = Number(k.slice(5, 7)) - 1;
      out.push({ label: `${shortMonth(mi)}${mi === 0 || out.length === 0 ? ` ${k.slice(2, 4)}` : ''}`, segments });
    }
    return out;
  }, [ctx.invoices, ctx.cards, ctx.today, hidden]);
  return (
    <Sheet
      visible={visible}
      title={t(TITLES.debt)}
      onClose={onClose}
      fixed={
        <>
          <Desc kind="debt" />
          <Total value={formatMoney(ctx.debt)} color={ctx.debt > 0 ? c.expense : c.text} />
          {groups.length > 0 ? (
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'chart' as const, label: t('Evolution') },
                { value: 'details' as const, label: t('Details') },
              ]}
            />
          ) : null}
        </>
      }
    >
      {groups.length === 0 ? (
        <Empty>{t('No card debt. Keep it up!')}</Empty>
      ) : (
        <>
          {tab === 'details' ? (
            groups.map((g) => (
              <View key={g.card.id} style={s.block}>
                <Line label={g.card.name} value={formatMoney(g.total)} color={c.expense} strong />
                {g.invoices.map((inv) => (
                  <View key={inv.key} style={s.sub}>
                    <Line label={t('{month} invoice · due {date}', { month: monthLabel(inv.key), date: dm(inv.dueDate) })} value={formatMoney(inv.amount)} muted />
                    {inv.items.map((o) => (
                      <Line key={o.key} indent label={`${o.description}${o.installment ? ` ${o.installment.index}/${o.installment.total}` : ''} · ${categoryLabel(o.category, o.type)}`} value={`${o.type === 'income' ? '-' : ''}${formatMoney(o.amount)}`} muted />
                    ))}
                    {inv.loans.map((o) => (
                      <Line key={o.key} indent strike label={`${o.description}${o.installment ? ` ${o.installment.index}/${o.installment.total}` : ''} · ${t('loan')}`} value={formatMoney(o.amount)} muted />
                    ))}
                    {inv.paid > 0 && <Line indent label={t('Already paid on this invoice')} value={`- ${formatMoney(inv.paid)}`} muted />}
                  </View>
                ))}
              </View>
            ))
          ) : (
            <>
              <BarChart groups={bars} />
              <ChartLegend
                items={ctx.cards.length > 1 ? ctx.cards.map((cd, ci) => ({ label: cd.name, color: cardColor(cd, ci), on: !hidden.includes(cd.id), onPress: () => toggleCard(cd.id) })) : []}
              />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function Commitments({ ctx, visible, onClose }: SheetProps) {
  const items = useMemo(() => commitmentItems(ctx.occ, endOfMonth(currentMonthKey())), [ctx.occ]);
  const byMonth = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of items) m.set(o.date.slice(0, 7), [...(m.get(o.date.slice(0, 7)) ?? []), o]);
    return [...m.entries()];
  }, [items]);
  return (
    <Sheet
      visible={visible}
      title={t(TITLES.commitments)}
      onClose={onClose}
      fixed={
        <>
          <Desc kind="commitments" />
          <Total value={formatMoney(ctx.commitments)} color={ctx.commitments > 0 ? c.warning : c.text} />
        </>
      }
    >
      {byMonth.length === 0 ? <Empty>{t('No pending commitments.')}</Empty> : null}
      {byMonth.map(([key, list]) => (
        <View key={key} style={s.block}>
          <Line label={monthLabel(key)} value={formatMoney(list.reduce((sum, o) => sum + o.amount, 0))} color={c.warning} strong />
          {list.map((o) => (
            <Line key={o.key} indent label={`${o.description}${o.installment ? ` ${o.installment.index}/${o.installment.total}` : ''}${o.fixed ? ` · ${t('fixed')}` : ''} · ${categoryLabel(o.category, o.type)} · ${dm(o.date)}`} value={formatMoney(o.amount)} muted />
          ))}
        </View>
      ))}
    </Sheet>
  );
}

function Freedom({ ctx, startKey, visible, onClose }: SheetProps & { startKey: string }) {
  const plan = useMemo(() => runwayPlan(ctx.worth, ctx.avgExpense, startKey, addMonthsToKey), [ctx.worth, ctx.avgExpense, startKey]);
  return (
    <Sheet
      visible={visible}
      title={t(TITLES.freedom)}
      onClose={onClose}
      fixed={
        <>
          <Desc kind="freedom" />
          <Total big value={ctx.runway === null ? '—' : formatRunway(ctx.runway)} color={ctx.runway === null ? c.text : ctx.runway < 3 ? c.expense : c.sky} />
        </>
      }
    >
      {plan.length === 0 ? (
        <Empty>{ctx.avgExpense <= 0 ? t('No expenses recorded to estimate spending for the coming months.') : t('No positive net worth to cover the coming months.')}</Empty>
      ) : (
        <>
          <View style={s.table}>
            <View style={[s.line, s.head]}>
              <Text style={[type.body, { color: c.textMuted, flex: 1.3 }]}>{t('Month')}</Text>
              <Text style={[type.body, { color: c.textMuted, flex: 1, textAlign: 'right' }]}>{t('Spent')}</Text>
              <Text style={[type.body, { color: c.textMuted, flex: 1.2, textAlign: 'right' }]}>{t('Left')}</Text>
            </View>
            {plan.map((row) => (
              <View key={row.key} style={s.rowBorder}>
                <View style={s.line}>
                  <Text style={[type.body, { color: c.text, flex: 1.3 }]} numberOfLines={1}>{monthLabel(row.key)}</Text>
                  <Text style={[type.body, { color: c.expense, flex: 1, textAlign: 'right' }]} numberOfLines={1}>- {formatMoney(row.spend)}</Text>
                  <Text style={[type.body, { color: row.remaining > 0 ? c.text : c.expense, flex: 1.2, textAlign: 'right', fontWeight: '600' }]} numberOfLines={1}>{formatMoney(row.remaining)}</Text>
                </View>
                <View style={{ flexDirection: 'row', paddingBottom: spacing.sm }}>
                  <AnimatedBar ratio={ctx.worth > 0 ? row.remaining / ctx.worth : 0} color={c.sky} height={6} />
                </View>
              </View>
            ))}
          </View>
          {plan.length >= 24 ? <Note>{t('Showing the first 24 months.')}</Note> : null}
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  total: { gap: 2 },
  table: { gap: 0 },
  head: { paddingBottom: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  rowBorder: { borderTopWidth: 1, borderColor: c.border },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  strike: { textDecorationLine: 'line-through' },
  sum: { height: 1, backgroundColor: c.border, marginVertical: spacing.xs },
  block: { backgroundColor: c.bg, borderRadius: radius.control, padding: spacing.md, gap: spacing.xs },
  sub: { gap: 0, marginTop: spacing.xs },
});
