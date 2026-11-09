import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { ChartLegend, ProjectionChart } from '../components/Charts';
import { PillToggle } from '../components/Controls';
import { addMonthsToKey, currentMonthKey, formatDate, formatMonth, monthLabel, pad, shortDate, todayISO } from '../domain/dates';
import { desktopBreakpoint, fontFamily, spacing, type, useColors } from '../theme';
import { motion, useGlide, useTween, useTweenList } from '../theme/motion';
import { CategoryShare, Summary } from './api';
import type { OwnChart } from '../domain/summary';
import { formatMoney, formatMoneyShort, formatMoneyShortIn } from '../domain/money';
import type { Tone } from '../types';
import { TONE_COLORS, categoryColor, defaultTone, sharedCategoryLabel, toneLabel } from '../domain/categories';
import { t, usePrefsVersion } from '../i18n';

const HORIZONS = ['month', 6, 12, 24, 'all'] as const;
type Horizon = (typeof HORIZONS)[number];
/** category colors: the app's palette without the brand blue, which means "saved" */
const PALETTE = ['#E0446A', '#D9831F', '#8B5CF6', '#0EA5E9', '#1FA86A', '#F28BA3', '#B98A5E'];
const OTHER = '#9AA5BC';
/** the donut's largest size, its ring thickness and the room left around it for the percentage that points at a slice */
const PIE_MAX = 320;
const RING_FULL = 40;
const RING_COMPACT = 30;
const MARGIN_X_FULL = 124;
const MARGIN_X_COMPACT = 78;
const MARGIN_Y = 44;

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Month = Summary['months'][number];

const polar = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + r * Math.cos(((deg - 90) * Math.PI) / 180), y: cy + r * Math.sin(((deg - 90) * Math.PI) / 180) });
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const s = polar(cx, cy, r, a0);
  const e = polar(cx, cy, r, a1);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
};

/**
 * A donut: one slice per category. Hovering (or tapping) a slice makes it stand out and puts its percentage outside the
 * ring, at the end of a thin line from the slice. `onSelect` is told which slice the pointer is on.
 */
function Pie({ slices, outer, selected, onSelect, size, compact, center, valueText }: { slices: { key: string; value: number; color: string; /** shown beside the percentage of the chosen slice */ name?: string; tone?: { label: string; color: string } | null }[]; selected: string | null; onSelect: (key: string | null) => void; size: number; /** phones: a thinner ring and less room around it */ compact: boolean; center: React.ReactNode; /** an outer, thin ring (what came in), split by category, drawn around the donut; its keys must not clash with the slices' */ outer?: { key: string; value: number; color: string; name?: string }[]; /** how the chosen slice's value is written beside it (default: its share of the pie) */ valueText?: (v: number) => string }) {
  const c = useColors();
  const RING = compact ? RING_COMPACT : RING_FULL;
  const MARGIN_X = compact ? MARGIN_X_COMPACT : MARGIN_X_FULL;
  const n = slices.length;
  // everything eases: the slices grow in and reshape when the period changes, the chosen one swells and the others fade
  const values = useTweenList(slices.map((sl) => sl.value), motion.slow);
  const amounts = useTweenList([...slices.map((sl) => (selected === sl.key ? 1 : 0)), ...slices.map((sl) => (selected !== null && selected !== sl.key ? 1 : 0))], motion.fast + 60);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  // the outer ring (when there is one): thin, around the donut, which then gets a little smaller
  const ring2 = outer && outer.length > 0 ? (compact ? 12 : 16) : 0;
  const GAP = ring2 ? 6 : 0;
  const outerList = outer ?? [];
  const outerValues = useTweenList(outerList.map((sl) => sl.value), motion.slow);
  const outerAmounts = useTweenList([...outerList.map((sl) => (selected === sl.key ? 1 : 0)), ...outerList.map((sl) => (selected !== null && selected !== sl.key ? 1 : 0))], motion.fast + 60);
  const outerTotal = outerValues.reduce((a, b) => a + b, 0) || 1;
  const W = size + MARGIN_X * 2;
  const H = size + MARGIN_Y * 2;
  const cx = W / 2;
  const cy = H / 2;
  // the ring is drawn so that even the grown slice stays inside `size`
  const r = size / 2 - ring2 - GAP - RING / 2 - 4;
  const rOuter = size / 2 - ring2 / 2 - 4;
  // each slice's angles, from 12 o'clock clockwise
  let acc = 0;
  const spans = slices.map((sl, i) => {
    const sweep = ((values[i] ?? 0) / total) * 360;
    const span = { ...sl, a0: acc, a1: acc + sweep, grow: amounts[i] ?? 0, dim: amounts[n + i] ?? 0 };
    acc += sweep;
    return span;
  });
  let accOut = 0;
  const outerSpans = outerList.map((sl, i) => {
    const sweep = ((outerValues[i] ?? 0) / outerTotal) * 360;
    const span = { ...sl, a0: accOut, a1: accOut + sweep, grow: outerAmounts[i] ?? 0, dim: outerAmounts[outerList.length + i] ?? 0 };
    accOut += sweep;
    return span;
  });
  const everySpan = [...spans, ...outerSpans];
  const target = everySpan.find((x) => x.key === selected);

  // the leader line: it remembers the last slice so it can fade out in place, and it glides the short way round between slices
  const lastKey = useRef<string | null>(null);
  if (selected) lastKey.current = selected;
  const chosen = everySpan.find((x) => x.key === (selected ?? lastKey.current));
  const chosenOuter = !!chosen && outerSpans.some((x) => x.key === chosen.key);
  const midTarget = chosen ? (chosen.a0 + chosen.a1) / 2 : 0;
  const unwrapped = useRef(midTarget);
  if (selected && chosen) {
    const delta = ((((midTarget - unwrapped.current) % 360) + 540) % 360) - 180;
    unwrapped.current += delta;
  }
  const wasOn = useRef(false);
  const snapLeader = !!selected && !wasOn.current;
  useEffect(() => {
    wasOn.current = !!selected;
  });
  const mid = useGlide(unwrapped.current, snapLeader, motion.fast + 60);
  const lead = useTween(selected ? 1 : 0, motion.fast + 60);

  /** which slice is at a point of the donut area (pointer position relative to its top left corner) */
  const hit = (px: number, py: number): string | null => {
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    // the thin outer ring first, then the donut
    if (ring2 && dist >= rOuter - ring2 / 2 - 4 && dist <= size / 2 + 6) return outerSpans.find((x2) => angle >= x2.a0 && angle < x2.a1)?.key ?? null;
    if (dist < r - RING / 2 - 8 || dist > r + RING / 2 + 8) return null;
    return spans.find((x2) => angle >= x2.a0 && angle < x2.a1)?.key ?? null;
  };

  // the line from the slice to its percentage: out of the ring, a short elbow, then sideways
  let leader: React.ReactNode = null;
  if (chosen && lead > 0.01) {
    const side = Math.sin((mid * Math.PI) / 180) >= 0 ? 1 : -1;
    // from the edge of the slice that was chosen (the donut's, or the outer ring's), out past the outside of everything
    const p0 = polar(cx, cy, chosenOuter || !ring2 ? size / 2 + 3 : r + RING / 2 + 2, mid);
    const p1 = polar(cx, cy, size / 2 + 3 + (compact ? 9 : 17) * lead, mid);
    const p2 = { x: p1.x + side * (compact ? 7 : 18) * lead, y: p1.y };
    leader = (
      <>
        <Path d={`M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`} stroke={chosen.color} strokeOpacity={lead} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {(() => {
          const cut = (text: string) => (text.length > (compact ? 9 : 15) ? `${text.slice(0, compact ? 8 : 14)}…` : text);
          const anchor = side > 0 ? 'start' : 'end';
          const x = p2.x + side * 5;
          // above the percentage when the slice is in the top half (the ring is below it), below it otherwise
          const up = p2.y < cy;
          const yName = up ? p2.y - 12 : p2.y + 24;
          return (
            <>
              <SvgText x={x} y={p2.y + 6} fontSize={compact ? 16 : 17} fontWeight="700" fontFamily={fontFamily} fill={chosen.color} fillOpacity={lead} textAnchor={anchor}>{valueText ? valueText((target ?? chosen).value) : pct(r1(((target ?? chosen).value / pieTotalOf(chosenOuter ? outerList : slices)) * 100))}</SvgText>
              {chosen.name ? <SvgText x={x} y={yName} fontSize={16} fontFamily={fontFamily} fill={c.text} fillOpacity={lead} textAnchor={anchor}>{cut(chosen.name)}</SvgText> : null}
            </>
          );
        })()}
      </>
    );
  }

  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }}>
      <Svg width={W} height={H}>
        <Path d={arc(cx, cy, r, 0, 359.99)} stroke={c.surface} strokeWidth={RING} fill="none" />
        {spans.map((sl) => {
          const sweep = sl.a1 - sl.a0;
          if (sweep < 0.4) return null;
          return <Path key={sl.key} d={arc(cx, cy, r, sl.a0 + 0.6, Math.max(sl.a1 - 0.6, sl.a0 + 0.2))} stroke={sl.color} strokeWidth={RING + 8 * sl.grow} strokeOpacity={1 - 0.65 * sl.dim} fill="none" />;
        })}
        {/* what came in: a thin ring around the donut, whole (it is 100%), split by income category */}
        {ring2 ? <Path d={arc(cx, cy, rOuter, 0, 359.99)} stroke={c.surface} strokeWidth={ring2} fill="none" /> : null}
        {outerSpans.map((sl) => {
          const sweep = sl.a1 - sl.a0;
          if (sweep < 0.4) return null;
          return <Path key={sl.key} d={arc(cx, cy, rOuter, sl.a0 + 0.6, Math.max(sl.a1 - 0.6, sl.a0 + 0.2))} stroke={sl.color} strokeWidth={ring2 + 5 * sl.grow} strokeOpacity={1 - 0.65 * sl.dim} fill="none" />;
        })}
        {leader}
      </Svg>
      <View pointerEvents="none" style={s.pieCenter}>{center}</View>
      {/* the pointer: hover on the web, a tap on a phone */}
      <Pressable
        accessibilityRole="image"
        accessibilityLabel={t('Spending by category')}
        onPress={(e: any) => {
          const k = hit(e.nativeEvent.locationX, e.nativeEvent.locationY);
          onSelect(k === selected ? null : k);
        }}
        {...({
          onMouseMove: (e: any) => {
            const box = e.currentTarget.getBoundingClientRect();
            onSelect(hit(e.clientX - box.left, e.clientY - box.top));
          },
          onMouseLeave: () => onSelect(null),
        } as object)}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** The slices' values add up to the whole the percentages are shares of (from the target values, not the ones still easing). */
const pieTotalOf = (slices: { value: number }[]) => slices.reduce((a, b) => a + b.value, 0) || 1;

/**
 * The shared summary, always in percentages: a line chart of the months around today (6, 12 or 24 of them, the past and
 * what is already planned, with a dotted line at "now"), and beside it a pie of where the spending goes in that same period.
 * Used for the own profile (live) and for the summary somebody shared.
 */
export function SummaryView({ summary, updatedAt, real, realCurrency }: { summary: Summary; updatedAt?: number | null; /** real money instead of percent: my own profile, or the profile of somebody who chose to show me their amounts */ real?: OwnChart; /** the currency of `real` when it is somebody else's (mine is the one on screen) */ realCurrency?: string }) {
  const money = (cents: number) => (realCurrency ? formatMoneyShortIn(cents, realCurrency) : formatMoneyShort(cents));
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;
  const [horizon, setHorizon] = useState<Horizon>('month');
  const [sel, setSel] = useState<number | null>(null);
  const [slice, setSlice] = useState<string | null>(null);
  /** the pie column's size: the line chart takes its height, and the pie fits its width */
  const [pieBox, setPieBox] = useState({ w: 0, h: 0 });
  /** the row that holds the donut and its legend */
  const [rowW, setRowW] = useState(0);
  useEffect(() => {
    setSel(null);
    setSlice(null);
  }, [horizon]);

  // the months of the range, ending in this one: what actually happened, never a projection. A month the summary does not have is an empty one
  const current = currentMonthKey();
  // "this month" narrows the percentages to the current month; the line chart then shows its days (and keeps a 6 month window as a fallback)
  // the first month with anything in it: "since the start" begins there (never earlier, never fewer than three months)
  const firstDataKey = useMemo(() => {
    if (real) return Object.keys(real.months).sort().find((k) => (real.months[k]!.income || real.months[k]!.expense) > 0);
    return [...summary.months].sort((a, b) => a.key.localeCompare(b.key)).find((m) => m.spent > 0 || m.saved !== 0 || (m.incomeRel ?? 0) > 0)?.key;
  }, [real, summary]);
  const sinceStart = firstDataKey ? (Number(current.slice(0, 4)) * 12 + Number(current.slice(5, 7))) - (Number(firstDataKey.slice(0, 4)) * 12 + Number(firstDataKey.slice(5, 7))) + 1 : 3;
  const span = horizon === 'month' ? 6 : horizon === 'all' ? Math.max(3, sinceStart) : horizon;
  const months: Month[] = useMemo(() => {
    const byKey = new Map(summary.months.map((m) => [m.key, m]));
    return Array.from({ length: span }, (_, i) => {
      const k = addMonthsToKey(current, i - (span - 1));
      return byKey.get(k) ?? { key: k, spent: 0, saved: 0, incomeRel: 0, categories: [] };
    });
  }, [summary, span, current]);
  const weight = (m: Month) => (m.incomeRel === undefined ? (m.spent > 0 || m.saved !== 0 ? 100 : 0) : m.incomeRel);

  // where the spending goes in the range: each month's category shares weighted by that month's income
  const lang = usePrefsVersion();
  const { categories, spentOfIncome } = useMemo(() => {
    const scope = horizon === 'month' ? months.filter((m) => m.key === current) : months;
    const totalWeight = scope.reduce((a, m) => a + weight(m), 0);
    const agg = new Map<string, { label: string; w: number; tone?: Tone }>();
    for (const m of scope) for (const x of m.categories) agg.set(x.slug, { label: sharedCategoryLabel(x.slug, x.label), tone: x.tone, w: (agg.get(x.slug)?.w ?? 0) + x.pct * weight(m) });
    const list: CategoryShare[] = totalWeight > 0 ? [...agg].map(([slug, v]) => ({ slug, label: v.label, pct: v.w / totalWeight, tone: v.tone })).filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct) : [];
    return { categories: list, spentOfIncome: list.reduce((a, x) => a + x.pct, 0) };
  }, [months, horizon, current, lang]);

  const shownSpent = useTween(spentOfIncome, motion.slow);
  // the chart is always drawn, with the whole range selected (empty months included); only the pie says when there is nothing to show
  const chartMonths = months;

  // my own profile: the amounts spent in the range (this month, or the months of the range), biggest first
  const rangeKeys = horizon === 'month' ? [current] : months.map((m) => m.key);
  const realCats = real
    ? real.categories
        .map((x) => ({ slug: x.slug, label: x.label, tone: x.tone ?? undefined, amount: rangeKeys.reduce((a, k) => a + (x.byMonth[k] ?? 0), 0) }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount)
    : null;
  const realTotal = realCats ? realCats.reduce((a, x) => a + x.amount, 0) : 0;

  const colorOf = (slug: string) => {
    // built-in categories have a color that says what they are (debt is red, investments green)
    const fixed = categoryColor(slug);
    if (fixed) return fixed;
    const i = (realCats ?? categories).findIndex((x) => x.slug === slug);
    if (i < 0) return OTHER;
    // after the fixed palette every category still gets its own color (hues spread by the golden angle)
    return i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 137.508) % 360)}, 55%, ${i % 2 ? 48 : 62}%)`;
  };
  // every category with a value is shown (one that rounds to 0% has nothing to show); none is folded into "everything else"
  // the owner's own classification; snapshots from before it existed fall back to the built-in default
  const toneOf = (x: CategoryShare) => {
    const tn = x.tone ?? defaultTone(x.slug);
    return tn ? { label: toneLabel(tn), color: TONE_COLORS[tn] } : null;
  };
  const pieRows = realCats
    ? realCats.map((x) => ({ key: x.slug, label: x.label, value: x.amount, color: colorOf(x.slug), name: x.label, tone: toneOf({ slug: x.slug, label: x.label, pct: 0, tone: x.tone }) }))
    : categories.filter((x) => r1(x.pct) > 0).map((x) => ({ key: x.slug, label: x.label, value: x.pct, color: colorOf(x.slug), name: x.label, tone: toneOf(x) }));
  /** how a slice's value is written: money on my own profile, a share of the pie otherwise */
  const sliceText = (v: number) => (realCats ? money(v) : pct(r1((v / (pieRows.reduce((a, x) => a + x.value, 0) || 1)) * 100)));
  // two columns on desktop, one on a phone (names, badges and percentages need the room)
  const legendW = wide ? Math.max(0, rowW - Math.min(PIE_MAX + MARGIN_X_FULL * 2, Math.max(360, rowW * 0.55)) - spacing.lg) : rowW;
  const legendCols = wide ? 2 : 1;

  // "this month": the days of the month, 1 to the last, with what came in and went out so far (percent of that month's income)
  const days = summary.days && summary.days.month === current ? summary.days : undefined;
  const dayMode = horizon === 'month';
  // only up to today: what is still to come is not drawn
  const todayIndex = Number(todayISO().slice(8, 10)) - 1;
  const zeros = Array.from({ length: todayIndex + 1 }, () => 0);
  const dayIncome = days ? days.income.slice(0, todayIndex + 1) : zeros;
  const daySpent = days ? days.spent.slice(0, todayIndex + 1) : zeros;
  // my own chart in real money: the days so far (kept to the days the summary draws)
  const realDays = { income: real ? real.days.income.slice(0, dayIncome.length) : zeros, spent: real ? real.days.spent.slice(0, dayIncome.length) : zeros };
  // "Day 1", "Day 2"...: long enough to lie on a diagonal, with every Nth shown when the days are tight
  const dayLabels = dayIncome.map((_, i) => t('Day {day}', { day: i + 1 }));
  const dayTips = dayIncome.map((_, i) => formatDate(`${current}-${pad(i + 1)}`));

  // the title says the range that is selected: the month with its year, or the first and the last month of the range
  const rangeTitle = horizon === 'month' ? monthLabel(current) : `${monthLabel(addMonthsToKey(current, -(span - 1)))} – ${monthLabel(current)}`;

  const chart = (
    <View style={{ gap: spacing.sm, minWidth: 0 }}>
      <ProjectionChart
        series={real && dayMode
          ? [
              { values: realDays.income, color: c.income, area: true, label: t('Received') },
              { values: realDays.spent, color: c.expense, dashed: true, label: t('Spent') },
              { values: realDays.income.map((v, i) => v - realDays.spent[i]!), color: c.primary, label: t('Saved') },
            ]
          : real
          ? [
              { values: chartMonths.map((m) => real.months[m.key]?.income ?? 0), color: c.income, area: true, label: t('Received') },
              { values: chartMonths.map((m) => real.months[m.key]?.expense ?? 0), color: c.expense, dashed: true, label: t('Spent') },
              { values: chartMonths.map((m) => (real.months[m.key]?.income ?? 0) - (real.months[m.key]?.expense ?? 0)), color: c.primary, label: t('Saved') },
            ]
          : dayMode
          ? [
              { values: dayIncome, color: c.income, area: true, label: t('Received') },
              { values: daySpent, color: c.expense, dashed: true, label: t('Spent') },
              { values: dayIncome.map((v, i) => v - daySpent[i]!), color: c.primary, label: t('Saved') },
            ]
          : [
              { values: chartMonths.map((m) => (m.incomeRel === undefined ? 100 : m.incomeRel)), color: c.income, area: true, label: t('Received') },
              { values: chartMonths.map((m) => (weight(m) * m.spent) / 100), color: c.expense, dashed: true, label: t('Spent') },
              { values: chartMonths.map((m) => (weight(m) * m.saved) / 100), color: c.primary, label: t('Saved') },
            ]}
        areaColor={c.income}
        height={wide ? 260 : 230}
        labels={dayMode ? dayLabels : chartMonths.map((m) => formatMonth(m.key))}
        tipLabels={dayMode ? dayTips : undefined}
        selected={sel}
        onSelect={setSel}
        format={real ? money : pct}
        fill
        tipWidth={real ? 230 : 310}
        renderTip={dayMode || real ? undefined : (i) => {
          const m = chartMonths[i];
          if (!m || weight(m) <= 0) return <Text style={[type.body, { color: c.textMuted }]}>{t('No income planned.')}</Text>;
          // the tooltip speaks in percent of THAT month's income (the lines are drawn scaled by how big the income was)
          const f = 1;
          const list = m.categories.slice(0, 4);
          const peak = Math.max(1, ...list.map((x) => x.pct * f));
          const over = m.saved < 0;
          return (
            <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              <View style={s.tipLines}>
                <View style={[s.tipPill, { backgroundColor: `${c.expense}1A` }]}>
                  <Text style={[type.body, { color: c.textMuted }]}>{t('Spent')}</Text>
                  <Text style={[type.label, { color: c.expense }]}>{pct(r1(f * m.spent))}</Text>
                </View>
                <View style={[s.tipPill, { backgroundColor: `${c.primary}1A` }]}>
                  <Text style={[type.body, { color: c.textMuted }]}>{t('Saved')}</Text>
                  <Text style={[type.label, { color: c.primary }]}>{pct(over ? 0 : r1(f * m.saved))}</Text>
                </View>
              </View>
              {/* how the month's income was shared between spending and saving */}
              <View style={[s.split, { backgroundColor: c.surface }]}>
                <View style={{ flex: Math.max(Math.min(m.spent, 100), 0.0001), backgroundColor: c.expense }} />
                {!over && m.saved > 0 ? <View style={{ flex: m.saved, backgroundColor: c.primary }} /> : null}
              </View>
              {list.length ? (
                <View style={{ gap: 6 }}>
                  {list.map((x) => (
                    <View key={x.slug} style={s.tipRow}>
                      <Text style={[type.body, { color: c.text, width: 124 }]} numberOfLines={1}>{sharedCategoryLabel(x.slug, x.label)}</Text>
                      <View style={[s.miniTrack, { backgroundColor: c.surface }]}>
                        <View style={{ width: `${((x.pct * f) / peak) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: colorOf(x.slug) }} />
                      </View>
                      <Text style={[type.body, { color: c.textMuted, width: 56, textAlign: 'right' }]}>{pct(r1(x.pct * f))}</Text>
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
          { label: t('Received'), color: c.income, line: true, on: true, onPress: () => {} },
          { label: t('Spent'), color: c.expense, line: true, dashed: true, on: true, onPress: () => {} },
          { label: t('Saved'), color: c.primary, line: true, on: true, onPress: () => {} },
        ]}
      />
    </View>
  );

  // my own profile: what came in (100%), by income category, as a thin ring around the donut and as its own list
  const INCOME_COLORS = ['#1FA86A', '#3DC18A', '#12805A', '#7DD6AC', '#2E9E6F', '#A5E3C6'];
  const incomeCats = real
    ? real.incomeCategories
        .map((x) => ({ slug: x.slug, label: x.label, amount: rangeKeys.reduce((a, k) => a + (x.byMonth[k] ?? 0), 0) }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount)
    : [];
  const incomeRows = incomeCats.map((x, i) => ({ key: `in:${x.slug}`, label: x.label, value: x.amount, color: INCOME_COLORS[i % INCOME_COLORS.length]!, name: x.label, tone: null as { label: string; color: string } | null }));
  const incomeTotal = incomeRows.reduce((a, x) => a + x.value, 0);

  const legendRow = (x: { key: string; label: string; value: number; color: string; tone: { label: string; color: string } | null }) => (
    <Pressable
      key={x.key}
      accessibilityRole="button"
      accessibilityLabel={`${x.label}: ${sliceText(x.value)}`}
      onPress={() => setSlice(slice === x.key ? null : x.key)}
      {...({ onHoverIn: () => setSlice(x.key), onHoverOut: () => setSlice(null) } as object)}
      style={({ hovered }: any) => [s.legendRow, { width: `${100 / legendCols - 2}%` as `${number}%` }, { backgroundColor: hovered || slice === x.key ? c.surface : 'transparent' }, Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '180ms' } as object)]}
    >
      <View style={[s.swatch, { backgroundColor: x.color }]} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={[type.body, { color: c.text, flexShrink: 1, minWidth: 0 }]} numberOfLines={1}>{x.label}</Text>
        {x.tone ? (
          <View style={{ flexShrink: 0, backgroundColor: `${x.tone.color}1F`, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 }}>
            <Text style={[type.body, { color: x.tone.color, fontSize: 16 }]} numberOfLines={1}>{x.tone.label}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[type.label, { color: c.text }]}>{sliceText(x.value)}</Text>
    </Pressable>
  );
  const listHead = (label: string, total: number, color: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingBottom: 2 }}>
      <Text style={[type.label, { color }]}>{label}</Text>
      <Text style={[type.label, { color }]}>{money(total)}</Text>
    </View>
  );

  const pie = (
    <View onLayout={(e) => setRowW(e.nativeEvent.layout.width)} style={[{ gap: spacing.lg }, wide && { flexDirection: 'row', alignItems: 'center' }]}>
      {pieRows.length === 0 && incomeRows.length === 0 ? (
        <Text style={[type.body, { color: c.textMuted }]}>{t('No expenses in this period.')}</Text>
      ) : (
        <>
          {/* the donut on the left (on top, on a phone) */}
          <View onLayout={(e) => setPieBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ width: wide ? Math.min(PIE_MAX + MARGIN_X_FULL * 2, Math.max(360, rowW * 0.55)) : undefined, flexShrink: 0 }}>
          <Pie
            slices={pieRows}
            outer={incomeRows}
            valueText={realCats ? sliceText : undefined}
            selected={slice}
            onSelect={setSlice}
            compact={!wide}
            size={Math.max(170, Math.min(PIE_MAX, (pieBox.w || PIE_MAX + MARGIN_X_FULL * 2) - (wide ? MARGIN_X_FULL : MARGIN_X_COMPACT) * 2))}
            center={
              <>
                <Text style={[type.title, { color: c.expense, fontSize: wide ? 20 : 22 }]}>{realCats ? money(realTotal) : pct(r1(shownSpent))}</Text>
                <Text style={[type.body, { color: c.textMuted }]}>{wide && !realCats && pieBox.w - MARGIN_X_FULL * 2 >= 240 ? t('of income spent') : t('spent')}</Text>
              </>
            }
          />
          </View>
          {/* the legend: a grid that fills the width beside the donut */}
          <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: spacing.md }}>
            {incomeRows.length > 0 ? (
              <View style={{ gap: 2 }}>
                {listHead(t('Received'), incomeTotal, c.income)}
                <View style={s.legendGrid}>{incomeRows.map(legendRow)}</View>
              </View>
            ) : null}
            <View style={{ gap: 2 }}>
              {incomeRows.length > 0 ? listHead(t('Spent'), realTotal, c.expense) : null}
              <View style={s.legendGrid}>{pieRows.map(legendRow)}</View>
            </View>
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={s.head}>
        <Text style={[type.label, { color: c.text, flexShrink: 1 }]}>{rangeTitle}</Text>
        <PillToggle stretch={!wide} value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: h === 'month' ? t('This month') : h === 'all' ? t('Beginning') : wide ? t('{n} months', { n: h }) : t('{n} mo.', { n: h }) }))} />
      </View>
      <View style={{ gap: spacing.xl }}>
        {chart}
        {pie}
      </View>
      {updatedAt ? <Text style={[type.body, { color: c.textMuted }]}>{t('Updated {date}', { date: shortDate(updatedAt) })}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  split: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  tipLines: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  tipPill: { flex: 1, minHeight: 44, borderRadius: 14, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  pieCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  legendGrid: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: 12 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
});
