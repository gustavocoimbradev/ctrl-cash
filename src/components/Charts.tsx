import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { formatMoney } from '../domain/money';
import { colors as c, fontFamily, radius, spacing, type } from '../theme';
import { motion, useProgress, useReducedMotion, useTweenList } from '../theme/motion';

/** Smooth curve (Catmull-Rom → Bézier) through the points. */
function smooth(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += ` C ${p1.x + (p2.x - p0.x) * t} ${p1.y + (p2.y - p0.y) * t}, ${p2.x - (p3.x - p1.x) * t} ${p2.y - (p3.y - p1.y) * t}, ${p2.x} ${p2.y}`;
  }
  return d;
}

interface Series {
  values: number[];
  color: string;
  dashed?: boolean;
  /** fills the area under the line */
  area?: boolean;
  label: string;
}

interface ProjectionProps {
  series: Series[];
  /** X-axis labels (one per point) */
  labels: string[];
  /** highlighted point (hover/touch); null = none (no tooltip) */
  selected: number | null;
  onSelect: (i: number | null) => void;
  height?: number;
  /** how a value is written (default: money) */
  format?: (v: number) => string;
  /** custom tooltip body for a point (default: one line per series with its value) */
  renderTip?: (i: number) => React.ReactNode;
  tipWidth?: number;
  /** color of the area under the first series (default: the brand blue) */
  areaColor?: string;
}

/** Line chart (up to 2 series, the first with an area), vertical guide and tooltip at the selected point. */
export function ProjectionChart({ series, labels, selected, onSelect, height = 230, format = formatMoney, renderTip, tipWidth = 190, areaColor = c.primary }: ProjectionProps) {
  const [w, setW] = useState(0);
  /** drawing: the lines reveal from left to right on enter and when the horizon changes */
  const progress = useProgress(`proj-${labels.length}`);
  const reduced = useReducedMotion();
  const tipV = useRef(new Animated.Value(0)).current;
  const lastSel = useRef<number | null>(selected);
  if (selected !== null) lastSel.current = selected;
  useEffect(() => {
    if (reduced) {
      tipV.setValue(selected === null ? 0 : 1);
      return;
    }
    Animated.timing(tipV, { toValue: selected === null ? 0 : 1, duration: motion.fast, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [selected, tipV, reduced]);
  const top = 12;
  const bottom = 8;
  const all = series.flatMap((s) => s.values);
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 1);
  const span = max - min || 1;
  const n = labels.length;
  const step = w / Math.max(n, 1);
  const x = (i: number) => step * i + step / 2;
  const y = (v: number) => top + (height - top - bottom) * (1 - (v - min) / span);
  const sel = selected === null ? null : Math.min(selected, n - 1);
  const zeroY = y(0);
  const tipW = tipWidth;
  /** diagonal labels need about 28px per column; with less, show every Nth (still the full MM/YYYY) */
  const labelEvery = Math.max(1, Math.ceil(28 / Math.max(step, 1)));
  const LABEL_W = 84;
  // narrow charts (phones): steeper labels, so the first one does not stick out to the left of the card
  const steep = w < 520;
  const angle = steep ? -70 : -45;
  // the tooltip keeps the last point while fading out, instead of vanishing abruptly
  const tipSel = lastSel.current === null ? null : Math.min(lastSel.current, n - 1);
  const tipLeft = tipSel === null ? 0 : Math.min(Math.max(x(tipSel) - tipW / 2, 0), Math.max(w - tipW, 0));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <View style={{ height }}>
          <Svg width={w} height={height}>
            <Defs>
              <ClipPath id="reveal">
                <Rect x={0} y={0} width={Math.max(w * progress, 0.01)} height={height} />
              </ClipPath>
              <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={areaColor} stopOpacity={0.3} />
                <Stop offset="1" stopColor={areaColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {[0, 1, 2, 3].map((i) => {
              const gy = top + ((height - top - bottom) / 3) * i;
              return <Line key={i} x1={0} y1={gy} x2={w} y2={gy} stroke={c.border} strokeWidth={1} />;
            })}
            {min < 0 && <Line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke={c.textMuted} strokeOpacity={0.4} strokeDasharray="4 4" strokeWidth={1} />}
            <G clipPath="url(#reveal)">
            {series.map((sr, k) => {
              const pts = sr.values.map((v, i) => ({ x: x(i), y: y(v) }));
              const line = smooth(pts);
              const area = pts.length ? `${line} L ${pts[pts.length - 1].x} ${height - bottom} L ${pts[0].x} ${height - bottom} Z` : '';
              return (
                <React.Fragment key={k}>
                  {sr.area && <Path d={area} fill="url(#area)" />}
                  <Path d={line} stroke={sr.color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={sr.dashed ? '7 6' : undefined} />
                </React.Fragment>
              );
            })}
            </G>
            {sel !== null && <Line x1={x(sel)} y1={top} x2={x(sel)} y2={height - bottom} stroke={c.textMuted} strokeOpacity={0.5} strokeDasharray="3 4" strokeWidth={1} />}
            {sel !== null &&
              series.map((sr, k) => <Circle key={k} cx={x(sel)} cy={y(sr.values[sel])} r={5.5} fill="#FFFFFF" stroke={sr.color} strokeWidth={3} />)}
          </Svg>
          {/* touch/hover areas per column */}
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }} {...({ onMouseLeave: () => onSelect(null) } as object)}>
            {labels.map((_, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${labels[i]}: ${series.map((sr) => `${sr.label} ${format(sr.values[i])}`).join(', ')}`}
                onPress={() => onSelect(sel === i ? null : i)}
                {...({ onHoverIn: () => onSelect(i) } as object)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
          {tipSel !== null && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: tipLeft,
              opacity: tipV,
              transform: [{ translateY: tipV.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
              width: tipW,
              backgroundColor: c.card,
              borderRadius: radius.control,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              shadowColor: '#0B1E3F',
              shadowOpacity: 0.14,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{labels[tipSel]}</Text>
            {renderTip
              ? renderTip(tipSel)
              : series.map((sr, k) => (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sr.color }} />
                    <Text style={[type.label, { color: sr.values[tipSel] < 0 ? c.expense : c.text, flex: 1 }]} numberOfLines={1}>{format(sr.values[tipSel])}</Text>
                  </View>
                ))}
          </Animated.View>
          )}
        </View>
      )}
      {/* X axis: full MM/YYYY labels, diagonal, below the chart; every Nth one only if the columns are too tight */}
      <View style={{ height: steep ? 84 : 60, marginTop: spacing.xs }}>
        {labels.map((l, i) => {
          if (i % labelEvery !== 0) return null;
          return (
            <Text
              key={i}
              numberOfLines={1}
              style={[
                { position: 'absolute', top: 4, left: x(i) - LABEL_W, width: LABEL_W, textAlign: 'right', fontFamily, fontSize: 16, lineHeight: 20, color: i === sel ? c.text : c.textMuted, fontWeight: i === sel ? '700' : '400' },
                { transform: [{ rotate: `${angle}deg` }], transformOrigin: '100% 50%' } as object,
              ]}
            >
              {l}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

interface GaugeProps {
  /** slices: value used by each item (in order), with color */
  segments: { value: number; color: string }[];
  /** total that represents the full ring (e.g. summed limit) */
  total: number;
  size?: number;
  /** gradient of the progress arc (e.g. [start, end]); without it each slice uses its own color */
  gradient?: [string, string];
  children?: React.ReactNode;
}

const polar = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + r * Math.cos((deg * Math.PI) / 180), y: cy + r * Math.sin((deg * Math.PI) / 180) });
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const s = polar(cx, cy, r, a0);
  const e = polar(cx, cy, r, a1);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
};

/** Semicircle gauge: light track and one colored slice per item, proportional to the total. */
export function Gauge({ segments, total, size = 240, gradient, children }: GaugeProps) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const h = size / 2 + stroke;
  let from = 180;
  const gap = 3;
  /** the arc grows from 0 on enter and, when the values change, moves from where it is to the new value */
  const shown = useTweenList(segments.map((s) => s.value));
  return (
    <View style={{ width: size, height: h, alignItems: 'center' }}>
      <Svg width={size} height={h}>
        {gradient && (
          <Defs>
            <LinearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={gradient[0]} />
              <Stop offset="1" stopColor={gradient[1]} />
            </LinearGradient>
          </Defs>
        )}
        <Path d={arc(cx, cy, r, 180, 360)} stroke={c.surfaceAlt} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        {total > 0 &&
          segments.map((sg, i) => {
            const sweep = Math.min(180 * ((shown[i] ?? 0) / total), 180 - (from - 180));
            if (sweep <= 0.5) return null;
            const a0 = from;
            const a1 = from + Math.max(sweep - gap, 0.5);
            from += sweep;
            return <Path key={i} d={arc(cx, cy, r, a0, a1)} stroke={gradient ? 'url(#gauge-grad)' : sg.color} strokeWidth={stroke} strokeLinecap="round" fill="none" />;
          })}
      </Svg>
      <View style={{ position: 'absolute', bottom: 0, alignItems: 'center' }}>{children}</View>
    </View>
  );
}

interface BarGroup {
  label: string;
  /** stacked slices (one per card, for example) */
  /** `paid`: already-paid part (lighter, with a small ✓ in its own segment, per card) */
  segments: { value: number; color: string; paid?: boolean }[];
}

/** Compacts the value when bars are narrow: 1,227.49 becomes "1.2k". */
const compactMoney = (cents: number) => {
  const v = cents / 100;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
};

/** Bar chart (stacked) that grows on enter; the total appears above each bar. */
export function BarChart({ groups, height = 220 }: { groups: BarGroup[]; height?: number }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const totals = groups.map((g) => g.segments.reduce((s, x) => s + x.value, 0));
  const grow = useProgress(`bars-${groups.length}-${totals.reduce((s, v) => s + v, 0)}`);
  const top = 28;
  const hasNeg = totals.some((v) => v < 0);
  // with negative values the bar descends from the zero line and the value sits below it
  const bottom = hasNeg ? 28 : 4;
  const max = Math.max(...totals, hasNeg ? 0 : 1);
  const min = Math.min(...totals, 0);
  const range = max - min || 1;
  const plotH = height - top - bottom;
  const unit = plotH / range;
  const zeroY = top + max * unit;
  const n = groups.length;
  const step = w / Math.max(n, 1);
  const barW = Math.min(44, step * 0.62);
  const barX = (i: number) => step * i + (step - barW) / 2;
  /** rectangle of the whole (stacked) bar, from zero upward (positive) or downward (negative) */
  const barRect = (i: number) => {
    const h = Math.abs(totals[i]) * unit * grow;
    return { x: barX(i), y: totals[i] >= 0 ? zeroY - h : zeroY, h };
  };
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <View style={{ height }}>
          <Svg width={w} height={height}>
            {[0, 1, 2, 3].map((i) => {
              const gy = top + (plotH / 3) * i;
              return <Line key={i} x1={0} y1={gy} x2={w} y2={gy} stroke={c.border} strokeWidth={1} />;
            })}
            {hasNeg && <Line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke={c.textMuted} strokeOpacity={0.5} strokeDasharray="4 4" strokeWidth={1} />}
            {/* each bar is a single block with rounded corners only at the ends (top and bottom); the slices are clipped inside it */}
            <Defs>
              <LinearGradient id="bar-sheen" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.28} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
              {groups.map((_, i) => {
                const r = barRect(i);
                const rad = Math.max(Math.min(6, barW / 2, r.h), 0);
                // rounded corners only at the tip (top; for negatives, the bottom), the other end stays flat on the zero line
                const d = totals[i] >= 0
                  ? `M ${r.x} ${r.y + r.h} L ${r.x} ${r.y + rad} Q ${r.x} ${r.y} ${r.x + rad} ${r.y} L ${r.x + barW - rad} ${r.y} Q ${r.x + barW} ${r.y} ${r.x + barW} ${r.y + rad} L ${r.x + barW} ${r.y + r.h} Z`
                  : `M ${r.x} ${r.y} L ${r.x + barW} ${r.y} L ${r.x + barW} ${r.y + r.h - rad} Q ${r.x + barW} ${r.y + r.h} ${r.x + barW - rad} ${r.y + r.h} L ${r.x + rad} ${r.y + r.h} Q ${r.x} ${r.y + r.h} ${r.x} ${r.y + r.h - rad} Z`;
                return (
                  <ClipPath key={`cp${i}`} id={`bar-${i}`}>
                    <Path d={d} />
                  </ClipPath>
                );
              })}
            </Defs>
            {groups.map((g, i) => {
              const up = totals[i] >= 0;
              let y = zeroY;
              return (
                <G key={i} clipPath={`url(#bar-${i})`} opacity={sel === null || sel === i ? 1 : 0.6}>
                  {g.segments.map((sg, k) => {
                    const h = Math.abs(sg.value) * unit * grow;
                    const ry = up ? y - h : y;
                    y = up ? y - h : y + h;
                    return <Rect key={k} x={barX(i)} y={ry} width={barW} height={Math.max(h, 0)} fill={sg.color} opacity={sg.paid ? 0.5 : 1} />;
                  })}
                  {/* subtle shine: light gradient at the top of the bar */}
                  <Rect x={barX(i)} y={barRect(i).y} width={barW} height={Math.max(barRect(i).h, 0)} fill="url(#bar-sheen)" />
                </G>
              );
            })}
            {/* discreet ✓ in the middle of each already-paid segment (each card shows its own) */}
            {groups.map((g, i) => {
              let y = zeroY;
              const cx = step * i + step / 2;
              return g.segments.map((sg, k) => {
                const h = Math.abs(sg.value) * unit * grow;
                y -= h;
                if (!sg.paid || h < 26) return null;
                const cy = y + h / 2;
                return (
                  <G key={`ck${i}-${k}`}>
                    <Circle cx={cx} cy={cy} r={9} fill="#FFFFFF" opacity={0.92 * grow} />
                    <Path d={`M ${cx - 4} ${cy} L ${cx - 1} ${cy + 3} L ${cx + 4.5} ${cy - 3}`} stroke={sg.color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={grow} />
                  </G>
                );
              });
            })}
          </Svg>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }} {...({ onMouseLeave: () => setSel(null) } as object)}>
            {groups.map((g, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${g.label}: ${formatMoney(totals[i])}`}
                onPress={() => setSel(sel === i ? null : i)}
                {...({ onHoverIn: () => setSel(i) } as object)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
          {/* value always visible: above the bar (positive) or below it (negative) */}
          {groups.map((g, i) => {
            if (totals[i] === 0) return null;
            const r = barRect(i);
            return (
              <Text
                key={`v${i}`}
                pointerEvents="none"
                numberOfLines={1}
                style={[
                  type.label,
                  { position: 'absolute', left: step * i, width: step, textAlign: 'center', top: totals[i] > 0 ? r.y - 24 : r.y + r.h + 2, color: totals[i] < 0 ? c.expense : sel === null || sel === i ? c.text : c.textMuted, opacity: grow },
                ]}
              >
                {step < 92 ? `${totals[i] < 0 ? '-' : ''}${compactMoney(Math.abs(totals[i]))}` : formatMoney(totals[i])}
              </Text>
            );
          })}
        </View>
      )}
      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
        {groups.map((g, i) => (
          <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Text style={{ textAlign: 'center', fontFamily, fontSize: 16, color: i === sel ? c.text : c.textMuted, fontWeight: i === sel ? '700' : '400' }} numberOfLines={1}>
              {g.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  /** dash (line) instead of a dot */
  line?: boolean;
  /** dotted line (same as the series in the chart) */
  dashed?: boolean;
  on: boolean;
  onPress: () => void;
}

/** Legend that also filters: tapping toggles the series (at least one always stays on). */
export function ChartLegend({ items, extra }: { items: LegendItem[]; /** fixed item (does not filter), e.g. paid invoice indicator */ extra?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' }}>
      {items.map((it) => (
        <Pressable
          key={it.label}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: it.on }}
          accessibilityLabel={`${it.on ? 'Hide' : 'Show'} ${it.label}`}
          onPress={it.onPress}
          style={({ pressed, hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.6 : 1 })}
        >
          {it.line && it.dashed ? (
            <View style={{ flexDirection: 'row', gap: 3, opacity: it.on ? 1 : 0.4 }}>
              {[0, 1, 2].map((k) => (
                <View key={k} style={{ width: 5, height: 4, borderRadius: 2, backgroundColor: it.on ? it.color : c.textMuted }} />
              ))}
            </View>
          ) : (
            <View style={it.line ? { width: 22, height: 4, borderRadius: 2, backgroundColor: it.on ? it.color : c.textMuted, opacity: it.on ? 1 : 0.4 } : { width: 10, height: 10, borderRadius: 5, backgroundColor: it.on ? it.color : c.textMuted, opacity: it.on ? 1 : 0.4 }} />
          )}
          <Text style={[type.body, { color: it.on ? c.text : c.textMuted, textDecorationLine: it.on ? 'none' : 'line-through' }]}>{it.label}</Text>
        </Pressable>
      ))}
      {extra}
    </View>
  );
}
