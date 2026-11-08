import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AnimatedBar } from '../components/Motion';
import { formatMoney } from '../domain/money';
import { monthLabel } from '../domain/dates';
import { radius, spacing, type, useColors } from '../theme';
import { Summary } from './api';

const SHOWN_CATEGORIES = 6;
const BAR_AREA = 72;

/**
 * The shared summary: totals of the last months, what was left over in each month and how the expenses split by
 * category. Short on purpose: no single transaction is ever shown. Used for the own profile (live) and for the
 * summary somebody shared.
 */
export function SummaryView({ summary, updatedAt }: { summary: Summary; updatedAt?: number | null }) {
  const c = useColors();
  const { months, categories } = summary;
  const income = months.reduce((s, m) => s + m.income, 0);
  const expense = months.reduce((s, m) => s + m.expense, 0);
  const left = income - expense;
  const rate = income > 0 ? Math.round((left / income) * 100) : null;
  const peak = Math.max(1, ...months.map((m) => Math.abs(m.left)));
  // room above the zero line only if some month has a leftover, below it only if some month fell short
  const up = months.some((m) => m.left > 0) || !months.some((m) => m.left < 0) ? BAR_AREA : 0;
  const down = months.some((m) => m.left < 0) ? BAR_AREA : 0;
  const spent = categories.reduce((s, x) => s + x.amount, 0);
  const top = categories.slice(0, SHOWN_CATEGORIES);
  const rest = categories.slice(SHOWN_CATEGORIES).reduce((s, x) => s + x.amount, 0);
  const rows = rest > 0 ? [...top, { slug: '_rest', label: 'Everything else', amount: rest }] : top;

  const stat = (label: string, value: string, color: string) => (
    <View style={[s.stat, { backgroundColor: c.surface }]}>
      <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{label}</Text>
      <Text style={[type.label, { color, fontSize: 18 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
    </View>
  );

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Last {months.length} months</Text>
        <View style={s.stats}>
          {stat('Income', formatMoney(income), c.income)}
          {stat('Expenses', formatMoney(expense), c.expense)}
        </View>
        <View style={s.stats}>
          {stat('Left over', formatMoney(left), left < 0 ? c.expense : c.primary)}
          {stat('Saved', rate === null ? '-' : `${rate}%`, rate !== null && rate < 0 ? c.expense : c.primary)}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Left over by month</Text>
        <View style={[s.chart, { height: up + down + 4 }]}>
          {/* the zero line sits in the middle: leftovers rise above it, shortfalls go below */}
          <View pointerEvents="none" style={[s.zero, { backgroundColor: c.border, top: up + 1 }]} />
          {months.map((m) => {
            const h = Math.max(3, Math.round((Math.abs(m.left) / peak) * BAR_AREA));
            const negative = m.left < 0;
            return (
              <View key={m.key} style={s.col} accessibilityLabel={`${monthLabel(m.key)}: ${formatMoney(m.left)}`}>
                {up > 0 ? <View style={{ height: up, justifyContent: 'flex-end' }}>{!negative && m.left !== 0 ? <View style={[s.bar, { height: h, backgroundColor: c.primary }]} /> : null}</View> : null}
                {down > 0 ? <View style={{ height: down, justifyContent: 'flex-start' }}>{negative ? <View style={[s.bar, { height: h, backgroundColor: c.expense }]} /> : null}</View> : null}
              </View>
            );
          })}
        </View>
        <View style={s.labels}>
          {months.map((m) => (
            <Text key={m.key} style={[s.label, { color: c.textMuted }]} numberOfLines={1}>{monthLabel(m.key).slice(0, 1)}</Text>
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.md }}>
        <Text style={[type.label, { color: c.text }]}>Where the money goes</Text>
        {rows.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>No expenses yet.</Text> : null}
        {rows.map((x, i) => {
          const share = spent > 0 ? x.amount / spent : 0;
          return (
            <View key={x.slug} style={{ gap: 6 }}>
              <View style={s.catHead}>
                <Text style={[type.body, { color: c.text, flex: 1 }]} numberOfLines={1}>{x.label}</Text>
                <Text style={[type.label, { color: c.textMuted }]}>{Math.round(share * 100)}%</Text>
              </View>
              <AnimatedBar ratio={share} color={x.slug === '_rest' ? c.textMuted : i === 0 ? c.expense : c.primary} height={8} />
            </View>
          );
        })}
      </View>

      {updatedAt ? <Text style={[type.body, { color: c.textMuted }]}>Updated {new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, minWidth: 0, borderRadius: radius.control, paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: 2 },
  chart: { flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  zero: { position: 'absolute', left: 0, right: 0, height: 1 },
  col: { flex: 1 },
  bar: { width: '100%', borderRadius: 4 },
  labels: { flexDirection: 'row', gap: 4 },
  label: { flex: 1, textAlign: 'center', fontSize: 16 },
  catHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
});
