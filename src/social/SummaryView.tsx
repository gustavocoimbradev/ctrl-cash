import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedBar } from '../components/Motion';
import { monthLabel } from '../domain/dates';
import { radius, spacing, type, useColors } from '../theme';
import { CategoryShare, Summary } from './api';

const BAR_H = 160;
/** category colors: the app's palette without the brand blue, which means "saved" */
const PALETTE = ['#E0446A', '#D9831F', '#8B5CF6', '#0EA5E9', '#1FA86A', '#F28BA3', '#B98A5E'];
const OTHER = '#9AA5BC';

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/**
 * The shared summary, always in percentages of income: how much was spent and saved overall, a bar for each month split
 * by category (and what was saved), and where the spending goes. Tap (or hover) a month to read its breakdown. Used
 * for the own profile (live) and for the summary somebody shared.
 */
export function SummaryView({ summary, updatedAt }: { summary: Summary; updatedAt?: number | null }) {
  const c = useColors();
  const { months, categories } = summary;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [summary.generatedAt]);
  const selected = months.find((m) => m.key === picked) ?? months[months.length - 1];

  // the same category always has the same color: the biggest ones get the palette, the rest share a gray
  const colorOf = (slug: string) => {
    const i = categories.findIndex((x) => x.slug === slug);
    return i >= 0 && i < PALETTE.length ? PALETTE[i] : OTHER;
  };
  const top = categories.slice(0, PALETTE.length);
  const rest = categories.slice(PALETTE.length).reduce((s, x) => s + x.pct, 0);
  const scale = Math.max(100, ...months.map((m) => m.spent + Math.max(m.saved, 0)));

  if (months.length === 0) return <Text style={[type.body, { color: c.textMuted }]}>Nothing to show yet: add some income and expenses.</Text>;

  const list = (rows: CategoryShare[]) =>
    rows.map((x) => (
      <View key={x.slug} style={{ gap: 6 }}>
        <View style={s.catHead}>
          <View style={[s.dot, { backgroundColor: colorOf(x.slug) }]} />
          <Text style={[type.body, { color: c.text, flex: 1 }]} numberOfLines={1}>{x.label}</Text>
          <Text style={[type.label, { color: c.textMuted }]}>{pct(x.pct)}</Text>
        </View>
        <AnimatedBar ratio={Math.min(x.pct, 100) / 100} color={colorOf(x.slug)} height={8} />
      </View>
    ));

  return (
    <View style={{ gap: spacing.xl }}>
      {/* overall: spent and saved, as shares of the income */}
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Last {months.length} {months.length === 1 ? 'month' : 'months'}</Text>
        <View style={s.stats}>
          <View style={[s.stat, { backgroundColor: c.surface }]}>
            <Text style={[type.body, { color: c.textMuted }]}>Spent</Text>
            <Text style={[type.title, { color: c.expense }]}>{pct(summary.spent)}</Text>
          </View>
          <View style={[s.stat, { backgroundColor: c.surface }]}>
            <Text style={[type.body, { color: c.textMuted }]}>Saved</Text>
            <Text style={[type.title, { color: summary.saved < 0 ? c.expense : c.primary }]}>{pct(summary.saved)}</Text>
          </View>
        </View>
        <View style={[s.split, { backgroundColor: c.surface }]}>
          <View style={{ flex: Math.max(Math.min(summary.spent, 100), 0), backgroundColor: c.expense }} />
          <View style={{ flex: Math.max(Math.min(summary.saved, 100), 0), backgroundColor: c.primary }} />
        </View>
      </View>

      {/* each month: spending by category + what was saved, 100% = the month's income */}
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Month by month</Text>
        <View style={[s.chart, { height: BAR_H }]}>
          {months.map((m) => {
            const on = m.key === selected?.key;
            return (
              <Pressable
                key={m.key}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(m.key)}: spent ${pct(m.spent)}, saved ${pct(m.saved)}`}
                accessibilityState={{ selected: on }}
                onPress={() => setPicked(m.key)}
                {...(Platform.OS === 'web' ? ({ onMouseEnter: () => setPicked(m.key) } as object) : null)}
                style={[s.col, { opacity: on ? 1 : 0.55 }]}
              >
                <View style={[s.stack, { height: BAR_H * (Math.min((m.spent + Math.max(m.saved, 0)) / scale, 1)) }]}>
                  {m.saved > 0 ? <View style={{ flex: m.saved, backgroundColor: c.primary }} /> : null}
                  {m.categories.map((x) => <View key={x.slug} style={{ flex: x.pct, backgroundColor: colorOf(x.slug) }} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={s.labels}>
          {months.map((m) => (
            <Text key={m.key} style={[s.label, { color: m.key === selected?.key ? c.text : c.textMuted, fontWeight: m.key === selected?.key ? '700' : '400' }]} numberOfLines={1}>{monthLabel(m.key).slice(0, 1)}</Text>
          ))}
        </View>
        {selected ? (
          <View style={[s.detail, { backgroundColor: c.surface }]}>
            <Text style={[type.label, { color: c.text }]}>{monthLabel(selected.key)}</Text>
            <Text style={[type.body, { color: c.textMuted }]}>
              Spent <Text style={{ color: c.expense, fontWeight: '700' }}>{pct(selected.spent)}</Text> · {selected.saved < 0 ? 'Overspent' : 'Saved'}{' '}
              <Text style={{ color: selected.saved < 0 ? c.expense : c.primary, fontWeight: '700' }}>{pct(Math.abs(selected.saved))}</Text>
            </Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>{list(selected.categories)}</View>
          </View>
        ) : null}
      </View>

      {/* overall by category */}
      <View style={{ gap: spacing.md }}>
        <Text style={[type.label, { color: c.text }]}>Where the money goes</Text>
        {categories.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>No expenses yet.</Text> : null}
        {list(top)}
        {rest > 0 ? list([{ slug: '_rest', label: 'Everything else', pct: Math.round(rest * 10) / 10 }]) : null}
        <Text style={[type.body, { color: c.textMuted }]}>Percentages of income. Saved is what is left of it.</Text>
      </View>

      {updatedAt ? <Text style={[type.body, { color: c.textMuted }]}>Updated {new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, minWidth: 0, borderRadius: radius.control, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: 2 },
  split: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  stack: { width: '100%', borderRadius: 6, overflow: 'hidden', flexDirection: 'column-reverse' },
  labels: { flexDirection: 'row', gap: 6 },
  label: { flex: 1, textAlign: 'center', fontSize: 16 },
  detail: { borderRadius: radius.control, padding: spacing.lg, gap: 2 },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
