import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, glow, gradients, minTouch, radius, spacing, type } from '../theme';

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** active segment color by value */
  tint?: Partial<Record<T, string>>;
}

const SLIDE_MS = 250;
const SEG_PAD = 4;

/** Segmented selector with a sliding pill that changes color/glow with a fade. */
export function Segmented<T extends string>({ value, options, onChange, tint }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const pos = useRef(new Animated.Value(index)).current;
  const [width, setWidth] = useState(0);
  const segW = width > 0 ? (width - SEG_PAD * 2 - 2) / options.length : 0;

  useEffect(() => {
    Animated.timing(pos, {
      toValue: index,
      duration: SLIDE_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [index, pos]);

  const idx = options.map((_, i) => i);
  const colorsByIndex = options.map((o) => tint?.[o.value] ?? colors.primary);
  const range = (arr: any[]) => (arr.length > 1 ? { inputRange: idx, outputRange: arr } : { inputRange: [0, 1], outputRange: [arr[0], arr[0]] });
  const pillColor = pos.interpolate(range(colorsByIndex));
  const pillGlow = pos.interpolate(range(colorsByIndex));
  const translateX = pos.interpolate(range(options.map((_, i) => i * segW)));

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[s.segWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {segW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.pill,
            {
              width: segW,
              backgroundColor: pillColor,
              shadowColor: pillGlow,
              shadowOpacity: 0.2,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              transform: [{ translateX }],
            },
          ]}
        />
      )}
      {options.map((o, i) => {
        const textColor = pos.interpolate({
          inputRange: [i - 1, i, i + 1],
          outputRange: [colors.textMuted, '#FFFFFF', colors.textMuted],
          extrapolate: 'clamp',
        });
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [s.seg, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Animated.Text style={[type.label, { color: textColor }]}>{o.label}</Animated.Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface PillToggleProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** fills the full width (phone), with equal-width options */
  stretch?: boolean;
}

const PILL_PAD = 4;

/** Pill filter: the background slides (translateX, 250ms) to the chosen option, without vanishing and reappearing. */
export function PillToggle<T extends string | number>({ value, options, onChange, stretch }: PillToggleProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const pos = useRef(new Animated.Value(index)).current;
  const [width, setWidth] = useState(0);
  const itemW = width > 0 ? (width - PILL_PAD * 2) / options.length : 0;

  useEffect(() => {
    Animated.timing(pos, { toValue: index, duration: SLIDE_MS, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: false }).start();
  }, [index, pos]);

  const idx = options.map((_, i) => i);
  const translateX = pos.interpolate({ inputRange: idx.length > 1 ? idx : [0, 1], outputRange: idx.length > 1 ? idx.map((i) => i * itemW) : [0, 0] });

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[s.pillWrap, stretch && { alignSelf: 'stretch' }]}>
      {itemW > 0 && <Animated.View pointerEvents="none" style={[s.pillSlide, { width: itemW, transform: [{ translateX }] }]} />}
      {options.map((o, i) => {
        const textColor = pos.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [colors.textMuted, '#FFFFFF', colors.textMuted], extrapolate: 'clamp' });
        return (
          <Pressable key={String(o.value)} accessibilityRole="button" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)} style={[s.pillItem, stretch && { width: undefined, flex: 1 }]}>
            <Animated.Text style={[type.label, { color: textColor }]}>{o.label}</Animated.Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[type.body, { color: colors.textMuted }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** Progress bar with a gradient; changes tone with usage. */
export function ProgressBar({ ratio, goal }: { ratio: number; /** goal: never turns red; when complete it turns green */ goal?: boolean }) {
  const r = Math.max(0, Math.min(1, ratio));
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: r, duration: 500, useNativeDriver: false }).start();
  }, [r, anim]);
  const grad = goal
    ? r >= 1
      ? gradients.income
      : gradients.bar
    : r > 0.9
      ? gradients.expense
      : r > 0.7
        ? gradients.warn
        : gradients.bar;
  return (
    <View style={s.track}>
      <Animated.View style={{ width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), height: '100%' }}>
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: radius.pill }} />
      </Animated.View>
    </View>
  );
}

/** Confirmation checkbox with a spring micro-animation. */
export function CheckButton({ checked, tone, label, onPress }: { checked: boolean; tone: 'income' | 'expense' | 'primary'; label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scale.setValue(0.7);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [checked, scale]);
  const color = tone === 'income' ? colors.income : tone === 'primary' ? colors.primary : colors.expense;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onPress} style={s.checkHit}>
      <Animated.View
        style={[
          s.check,
          { borderColor: checked ? color : colors.textMuted, backgroundColor: checked ? color : 'transparent', transform: [{ scale }] },
          checked && glow(color, 12, 0.6),
        ]}
      >
        {checked && <Feather name="check" size={18} color="#FFFFFF" />}
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pillWrap: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: PILL_PAD, alignSelf: 'flex-start' },
  pillSlide: { position: 'absolute', top: PILL_PAD, left: PILL_PAD, bottom: PILL_PAD, borderRadius: radius.pill, backgroundColor: colors.sidebar },
  pillItem: { minHeight: 36, width: 96, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segWrap: { flexDirection: 'row', borderRadius: radius.control, padding: 4, borderWidth: 0 },
  pill: { position: 'absolute', top: SEG_PAD, left: SEG_PAD, height: minTouch - 8, borderRadius: radius.control - 4 },
  seg: { flex: 1, minHeight: minTouch - 8, borderRadius: radius.control - 4, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  checkHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  check: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
