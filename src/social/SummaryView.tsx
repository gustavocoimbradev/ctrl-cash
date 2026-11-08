import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChartLegend, ProjectionChart } from '../components/Charts';
import { AnimatedBar } from '../components/Motion';
import { formatMonth } from '../domain/dates';
import { spacing, type, useColors } from '../theme';
import { CategoryShare, Summary } from './api';

/** category colors: the app's palette without the brand blue, which means "saved" */
const PALETTE = ['#E0446A', '#D9831F', '#8B5CF6', '#0EA5E9', '#1FA86A', '#F28BA3', '#B98A5E'];
const OTHER = '#9AA5BC';

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/**
 * The shared summary, always in percentages of income: a line chart of what was spent and saved month
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
          <Text style={[type.label, { color: c.text }]}>{pct(x.pct)}</Text>
        </View>
        <View style={{ height: 14, flexDirection: 'row' }}>
          <AnimatedBar ratio={Math.min(x.pct, 100) / 100} color={colorOf(x.slug)} height={14} />
        </View>
      </View>
    ));

  return (
    <View style={{ gap: spacing.xl }}>
      {/* month by month: income is the main line and spending the secondary one, both as % of the person's average month income;
          the tooltip gives the month's own split (spent and saved as % of that month's income, then by category) */}
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Month by month</Text>
        <ProjectionChart
          series={[
            { values: months.map((m) => m.incomeRel ?? 100), color: c.income, area: true, label: 'Income' },
            { values: months.map((m) => ((m.incomeRel ?? 100) * m.spent) / 100), color: c.expense, dashed: true, label: 'Spent' },
          ]}
          areaColor={c.income}
          labels={months.map((m) => formatMonth(m.key))}
          selected={sel}
          onSelect={setSel}
          format={pct}
          tipWidth={310}
          renderTip={(i) => {
            const m = months[i];
            if (!m) return null;
            const income = m.incomeRel ?? 100;
            const top = m.categories.slice(0, 4);
            const peak = Math.max(1, ...top.map((x) => x.pct));
            const over = m.saved < 0;
            return (
              <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                <View style={s.tipLines}>
                  <View style={[s.tipPill, { backgroundColor: `${c.income}1A` }]}>
                    <Text style={[type.body, { color: c.textMuted }]}>Income</Text>
                    <Text style={[type.label, { color: c.income }]}>{pct(Math.round(income * 10) / 10)}</Text>
                  </View>
                  <View style={[s.tipPill, { backgroundColor: `${c.expense}1A` }]}>
                    <Text style={[type.body, { color: c.textMuted }]}>Spent</Text>
                    <Text style={[type.label, { color: c.expense }]}>{pct(Math.round(((income * m.spent) / 100) * 10) / 10)}</Text>
                  </View>
                </View>
                {/* what became of the month's income: the part spent and the part saved */}
                <View style={{ gap: 4 }}>
                  <View style={[s.split, { backgroundColor: c.surface }]}>
                    <View style={{ flex: Math.max(Math.min(m.spent, 100), 0.0001), backgroundColor: c.expense }} />
                    {!over && m.saved > 0 ? <View style={{ flex: m.saved, backgroundColor: c.primary }} /> : null}
                  </View>
                  <View style={s.tipLines}>
                    <Text style={[type.label, { color: c.expense }]}>{pct(m.spent)} spent</Text>
                    <Text style={[type.label, { color: over ? c.expense : c.primary }]}>{pct(Math.abs(m.saved))} {over ? 'over' : 'saved'}</Text>
                  </View>
                </View>
                {top.length ? (
                  <View style={{ gap: 6 }}>
                    {top.map((x) => (
                      <View key={x.slug} style={s.tipRow}>
                        <Text style={[type.body, { color: c.text, width: 124 }]} numberOfLines={1}>{x.label}</Text>
                        <View style={[s.miniTrack, { backgroundColor: c.surface }]}>
                          <View style={{ width: `${(x.pct / peak) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: colorOf(x.slug) }} />
                        </View>
                        <Text style={[type.body, { color: c.textMuted, width: 52, textAlign: 'right' }]}>{pct(x.pct)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
        <ChartLegend
          items={[
            { label: 'Income', color: c.income, line: true, on: true, onPress: () => {} },
            { label: 'Spent', color: c.expense, line: true, dashed: true, on: true, onPress: () => {} },
          ]}
        />
      </View>

      {/* overall by category: one bar for the whole, then a bar per category */}
      <View style={{ gap: spacing.md }}>
        <Text style={[type.label, { color: c.text }]}>Where the money goes</Text>
        {categories.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>No expenses yet.</Text> : null}
        {categories.length > 0 ? (
          <View style={[s.whole, { backgroundColor: c.surface }]}>
            {top.map((x) => <View key={x.slug} style={{ flex: Math.max(x.pct, 0.0001), backgroundColor: colorOf(x.slug) }} />)}
            {rest > 0 ? <View style={{ flex: rest, backgroundColor: OTHER }} /> : null}
          </View>
        ) : null}
        <View style={{ gap: spacing.md }}>
          {list(top)}
          {rest > 0 ? list([{ slug: '_rest', label: 'Everything else', pct: Math.round(rest * 10) / 10 }]) : null}
        </View>
      </View>

      {updatedAt ? <Text style={[type.body, { color: c.textMuted }]}>Updated {new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  split: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  whole: { flexDirection: 'row', height: 22, borderRadius: 11, overflow: 'hidden' },
  tipLines: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  tipPill: { flex: 1, minHeight: 44, borderRadius: 14, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
