import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChartLegend, ProjectionChart } from '../components/Charts';
import { AnimatedBar } from '../components/Motion';
import { formatMonth } from '../domain/dates';
import { radius, spacing, type, useColors } from '../theme';
import { CategoryShare, Summary } from './api';

/** category colors: the app's palette without the brand blue, which means "saved" */
const PALETTE = ['#E0446A', '#D9831F', '#8B5CF6', '#0EA5E9', '#1FA86A', '#F28BA3', '#B98A5E'];
const OTHER = '#9AA5BC';

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/**
 * The shared summary, always in percentages of income: how much was spent and saved overall, a line chart of both month
 * by month (hover or tap a month: a tooltip with its split by category) and where the spending goes. Used for the own
 * profile (live) and for the summary somebody shared.
 */
export function SummaryView({ summary, updatedAt }: { summary: Summary; updatedAt?: number | null }) {
  const c = useColors();
  const { months, categories } = summary;
  const [sel, setSel] = useState<number | null>(null);

  // the same category always has the same color: the biggest ones get the palette, the rest share a gray
  const colorOf = (slug: string) => {
    const i = categories.findIndex((x) => x.slug === slug);
    return i >= 0 && i < PALETTE.length ? PALETTE[i] : OTHER;
  };
  const top = categories.slice(0, PALETTE.length);
  const rest = categories.slice(PALETTE.length).reduce((s, x) => s + x.pct, 0);

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

      {/* month by month: the same line chart as the wealth projection, with a tooltip that splits the month by category */}
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Month by month</Text>
        <ProjectionChart
          series={[
            { values: months.map((m) => m.saved), color: c.primary, area: true, label: 'Saved' },
            { values: months.map((m) => m.spent), color: c.expense, label: 'Spent' },
          ]}
          labels={months.map((m) => formatMonth(m.key))}
          selected={sel}
          onSelect={setSel}
          format={pct}
          tipWidth={230}
          renderTip={(i) => {
            const m = months[i];
            if (!m) return null;
            return (
              <View style={{ gap: 2 }}>
                <View style={s.tipRow}>
                  <View style={[s.dot, { backgroundColor: c.expense }]} />
                  <Text style={[type.label, { color: c.text, flex: 1 }]} numberOfLines={1}>Spent</Text>
                  <Text style={[type.label, { color: c.expense }]}>{pct(m.spent)}</Text>
                </View>
                <View style={s.tipRow}>
                  <View style={[s.dot, { backgroundColor: c.primary }]} />
                  <Text style={[type.label, { color: c.text, flex: 1 }]} numberOfLines={1}>{m.saved < 0 ? 'Overspent' : 'Saved'}</Text>
                  <Text style={[type.label, { color: m.saved < 0 ? c.expense : c.primary }]}>{pct(Math.abs(m.saved))}</Text>
                </View>
                {m.categories.slice(0, 5).map((x) => (
                  <View key={x.slug} style={s.tipRow}>
                    <View style={[s.dot, { backgroundColor: colorOf(x.slug), width: 8, height: 8, borderRadius: 4 }]} />
                    <Text style={[type.body, { color: c.textMuted, flex: 1 }]} numberOfLines={1}>{x.label}</Text>
                    <Text style={[type.body, { color: c.textMuted }]}>{pct(x.pct)}</Text>
                  </View>
                ))}
              </View>
            );
          }}
        />
        <ChartLegend
          items={[
            { label: 'Saved', color: c.primary, line: true, on: true, onPress: () => {} },
            { label: 'Spent', color: c.expense, line: true, on: true, onPress: () => {} },
          ]}
        />
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
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
