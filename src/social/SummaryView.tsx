import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { ChartLegend, ProjectionChart } from '../components/Charts';
import { PillToggle } from '../components/Controls';
import { addMonthsToKey, currentMonthKey, formatMonth, shortDate } from '../domain/dates';
import { desktopBreakpoint, fontFamily, spacing, type, useColors } from '../theme';
import { motion, useGlide, useTween, useTweenList } from '../theme/motion';
import { CategoryShare, Summary } from './api';
import { sharedCategoryLabel } from '../domain/categories';
import { t, usePrefsVersion } from '../i18n';

const HORIZONS = [6, 12, 24] as const;
type Horizon = (typeof HORIZONS)[number];
/** category colors: the app's palette without the brand blue, which means "saved" */
const PALETTE = ['#E0446A', '#D9831F', '#8B5CF6', '#0EA5E9', '#1FA86A', '#F28BA3', '#B98A5E'];
const OTHER = '#9AA5BC';
/** the donut's largest size, its ring thickness and the room left around it for the percentage that points at a slice */
const PIE_MAX = 232;
const RING_FULL = 40;
const RING_COMPACT = 30;
const MARGIN_X_FULL = 104;
const MARGIN_X_COMPACT = 62;
const MARGIN_Y = 30;

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
function Pie({ slices, selected, onSelect, size, compact, center }: { slices: { key: string; value: number; color: string }[]; selected: string | null; onSelect: (key: string | null) => void; size: number; /** phones: a thinner ring and less room around it */ compact: boolean; center: React.ReactNode }) {
  const c = useColors();
  const RING = compact ? RING_COMPACT : RING_FULL;
  const MARGIN_X = compact ? MARGIN_X_COMPACT : MARGIN_X_FULL;
  const n = slices.length;
  // everything eases: the slices grow in and reshape when the period changes, the chosen one swells and the others fade
  const values = useTweenList(slices.map((sl) => sl.value), motion.slow);
  const amounts = useTweenList([...slices.map((sl) => (selected === sl.key ? 1 : 0)), ...slices.map((sl) => (selected !== null && selected !== sl.key ? 1 : 0))], motion.fast + 60);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const W = size + MARGIN_X * 2;
  const H = size + MARGIN_Y * 2;
  const cx = W / 2;
  const cy = H / 2;
  // the ring is drawn so that even the grown slice stays inside `size`
  const r = size / 2 - RING / 2 - 4;
  // each slice's angles, from 12 o'clock clockwise
  let acc = 0;
  const spans = slices.map((sl, i) => {
    const sweep = ((values[i] ?? 0) / total) * 360;
    const span = { ...sl, a0: acc, a1: acc + sweep, grow: amounts[i] ?? 0, dim: amounts[n + i] ?? 0 };
    acc += sweep;
    return span;
  });
  const target = spans.find((x) => x.key === selected);

  // the leader line: it remembers the last slice so it can fade out in place, and it glides the short way round between slices
  const lastKey = useRef<string | null>(null);
  if (selected) lastKey.current = selected;
  const chosen = spans.find((x) => x.key === (selected ?? lastKey.current));
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
    if (dist < size / 2 - RING - 10 || dist > size / 2 + 6) return null;
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    return spans.find((x2) => angle >= x2.a0 && angle < x2.a1)?.key ?? null;
  };

  // the line from the slice to its percentage: out of the ring, a short elbow, then sideways
  let leader: React.ReactNode = null;
  if (chosen && lead > 0.01) {
    const side = Math.sin((mid * Math.PI) / 180) >= 0 ? 1 : -1;
    const p0 = polar(cx, cy, size / 2 + 3, mid);
    const p1 = polar(cx, cy, size / 2 + 3 + (compact ? 9 : 17) * lead, mid);
    const p2 = { x: p1.x + side * (compact ? 7 : 18) * lead, y: p1.y };
    leader = (
      <>
        <Path d={`M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`} stroke={chosen.color} strokeOpacity={lead} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <SvgText x={p2.x + side * 5} y={p2.y + 6} fontSize={compact ? 16 : 17} fontWeight="700" fontFamily={fontFamily} fill={chosen.color} fillOpacity={lead} textAnchor={side > 0 ? 'start' : 'end'}>{pct(r1(((target ?? chosen).value / pieTotalOf(slices)) * 100))}</SvgText>
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
export function SummaryView({ summary, updatedAt }: { summary: Summary; updatedAt?: number | null }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;
  const [horizon, setHorizon] = useState<Horizon>(12);
  const [sel, setSel] = useState<number | null>(null);
  const [slice, setSlice] = useState<string | null>(null);
  /** the pie column's size: the line chart takes its height, and the pie fits its width */
  const [pieBox, setPieBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    setSel(null);
    setSlice(null);
  }, [horizon]);

  // the months of the range, half behind and half ahead of now; a month the summary does not have is an empty one
  const current = currentMonthKey();
  const half = horizon / 2;
  const months: Month[] = useMemo(() => {
    const byKey = new Map(summary.months.map((m) => [m.key, m]));
    const w = (m: Month) => (m.incomeRel === undefined ? (m.spent > 0 || m.saved !== 0 ? 100 : 0) : m.incomeRel);
    // what is known up to now: a month ahead with nothing planned is projected from it (an average month of the history
    // available, however short), instead of showing an empty future
    const known = summary.months.filter((m) => m.key <= current && w(m) > 0);
    const total = known.reduce((a, m) => a + w(m), 0);
    let typical: Month | null = null;
    if (total > 0) {
      const shares = new Map<string, { label: string; pct: number }>();
      for (const m of known) for (const x of m.categories) shares.set(x.slug, { label: x.label, pct: (shares.get(x.slug)?.pct ?? 0) + (x.pct * w(m)) / total });
      typical = {
        key: '',
        incomeRel: 100,
        spent: known.reduce((a, m) => a + m.spent * w(m), 0) / total,
        saved: known.reduce((a, m) => a + m.saved * w(m), 0) / total,
        categories: [...shares].map(([slug, v]) => ({ slug, label: v.label, pct: v.pct })).sort((x, y) => y.pct - x.pct),
      };
    }
    return Array.from({ length: horizon }, (_, i) => {
      const k = addMonthsToKey(current, i - half);
      const own = byKey.get(k);
      if (own && w(own) > 0) return own;
      if (typical && k > current) return { ...typical, key: k };
      return own ?? { key: k, spent: 0, saved: 0, incomeRel: 0, categories: [] };
    });
  }, [summary, horizon, half, current]);
  const weight = (m: Month) => (m.incomeRel === undefined ? (m.spent > 0 || m.saved !== 0 ? 100 : 0) : m.incomeRel);

  // where the spending goes in the range: each month's category shares weighted by that month's income
  const lang = usePrefsVersion();
  const { categories, spentOfIncome } = useMemo(() => {
    const totalWeight = months.reduce((a, m) => a + weight(m), 0);
    const agg = new Map<string, { label: string; w: number }>();
    for (const m of months) for (const x of m.categories) agg.set(x.slug, { label: sharedCategoryLabel(x.slug, x.label), w: (agg.get(x.slug)?.w ?? 0) + x.pct * weight(m) });
    const list: CategoryShare[] = totalWeight > 0 ? [...agg].map(([slug, v]) => ({ slug, label: v.label, pct: v.w / totalWeight })).filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct) : [];
    return { categories: list, spentOfIncome: list.reduce((a, x) => a + x.pct, 0) };
  }, [months, lang]);

  const shownSpent = useTween(spentOfIncome, motion.slow);
  const hasData = months.some((m) => weight(m) > 0);
  if (!hasData) return <Text style={[type.body, { color: c.textMuted }]}>{t('Nothing to show yet: add some income and expenses.')}</Text>;

  const colorOf = (slug: string) => {
    const i = categories.findIndex((x) => x.slug === slug);
    if (i < 0) return OTHER;
    // after the fixed palette every category still gets its own color (hues spread by the golden angle)
    return i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 137.508) % 360)}, 55%, ${i % 2 ? 48 : 62}%)`;
  };
  // every category is shown: none is folded into "everything else"
  const pieRows = categories.map((x) => ({ key: x.slug, label: x.label, value: x.pct, color: colorOf(x.slug) }));
  const pieTotal = pieRows.reduce((a, x) => a + x.value, 0) || 1;

  const chart = (
    <View style={{ gap: spacing.sm, flex: wide ? 1.7 : undefined, minWidth: 0 }}>
      <ProjectionChart
        series={[
          { values: months.map((m) => (m.incomeRel === undefined ? 100 : m.incomeRel)), color: c.income, area: true, label: t('Income') },
          { values: months.map((m) => (weight(m) * m.spent) / 100), color: c.expense, dashed: true, label: t('Spent') },
          { values: months.map((m) => (weight(m) * m.saved) / 100), color: c.primary, label: t('Saved') },
        ]}
        areaColor={c.income}
        height={wide && pieBox.h > 0 ? Math.max(230, pieBox.h - 112) : 230}
        labels={months.map((m) => formatMonth(m.key))}
        nowIndex={half}
        selected={sel}
        onSelect={setSel}
        format={pct}
        tipWidth={310}
        renderTip={(i) => {
          const m = months[i];
          if (!m || weight(m) <= 0) return <Text style={[type.body, { color: c.textMuted }]}>{t('No income planned.')}</Text>;
          const f = weight(m) / 100;
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
          { label: t('Income'), color: c.income, line: true, on: true, onPress: () => {} },
          { label: t('Spent'), color: c.expense, line: true, dashed: true, on: true, onPress: () => {} },
          { label: t('Saved'), color: c.primary, line: true, on: true, onPress: () => {} },
        ]}
      />
    </View>
  );

  const pie = (
    <View onLayout={(e) => setPieBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ gap: spacing.md, flex: wide ? 1 : undefined, minWidth: 0 }}>
      {pieRows.length === 0 ? (
        <Text style={[type.body, { color: c.textMuted }]}>{t('No expenses in this period.')}</Text>
      ) : (
        <>
          <Pie
            slices={pieRows}
            selected={slice}
            onSelect={setSlice}
            compact={!wide}
            size={Math.max(150, Math.min(PIE_MAX, (pieBox.w || PIE_MAX + MARGIN_X_FULL * 2) - (wide ? MARGIN_X_FULL : MARGIN_X_COMPACT) * 2))}
            center={
              <>
                <Text style={[type.title, { color: c.expense, fontSize: wide ? 20 : 22 }]}>{pct(r1(shownSpent))}</Text>
                <Text style={[type.body, { color: c.textMuted }]}>{wide ? t('of income spent') : t('spent')}</Text>
              </>
            }
          />
          <View style={{ gap: 2 }}>
            {pieRows.map((x) => (
              <Pressable
                key={x.key}
                accessibilityRole="button"
                accessibilityLabel={`${x.label}: ${pct(r1((x.value / pieTotal) * 100))}`}
                onPress={() => setSlice(slice === x.key ? null : x.key)}
                {...({ onHoverIn: () => setSlice(x.key), onHoverOut: () => setSlice(null) } as object)}
                style={({ hovered }: any) => [s.legendRow, { backgroundColor: hovered || slice === x.key ? c.surface : 'transparent' }, Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '180ms' } as object)]}
              >
                <View style={[s.swatch, { backgroundColor: x.color }]} />
                <Text style={[type.body, { color: c.text, flex: 1 }]} numberOfLines={1}>{x.label}</Text>
                <Text style={[type.label, { color: c.text }]}>{pct(r1((x.value / pieTotal) * 100))}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={s.head}>
        {wide ? <Text style={[type.label, { color: c.text }]}>{t('Month by month')}</Text> : null}
        <PillToggle stretch={!wide} value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: t('{n} months', { n: h }) }))} />
      </View>
      <View style={[{ gap: spacing.xl }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
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
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: 12 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
});
