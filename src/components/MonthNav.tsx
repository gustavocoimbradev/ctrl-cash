import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { addMonthsToKey, currentMonthKey, monthLabel } from '../domain/dates';
import { colors as c, minTouch, radius, type } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { t } from '../i18n';

/** Month picker: ‹ Month Year › (tapping the name returns to the current month). The name slides in the direction of the change. */
export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const reduced = useReducedMotion();
  const prev = useRef(month);
  const v = useRef(new Animated.Value(1)).current;
  const dir = useRef(1);
  useEffect(() => {
    if (prev.current === month) return;
    dir.current = month > prev.current ? 1 : -1;
    prev.current = month;
    if (reduced) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: motion.base, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [month, v, reduced]);
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [dir.current * 18, 0] });

  return (
    <View style={s.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Previous month')} onPress={() => onChange(addMonthsToKey(month, -1))} style={({ pressed, hovered }: any) => [s.btn, { backgroundColor: hovered ? c.surfaceAlt : 'transparent', opacity: pressed ? 0.6 : 1 }]}>
        <Feather name="chevron-left" size={22} color={c.textMuted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Go to current month')} onPress={() => onChange(currentMonthKey())} style={s.label}>
        <Animated.Text style={[type.label, { color: c.text, opacity: v, transform: [{ translateX }] }]} numberOfLines={1}>{monthLabel(month)}</Animated.Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Next month')} onPress={() => onChange(addMonthsToKey(month, 1))} style={({ pressed, hovered }: any) => [s.btn, { backgroundColor: hovered ? c.surfaceAlt : 'transparent', opacity: pressed ? 0.6 : 1 }]}>
        <Feather name="chevron-right" size={22} color={c.textMuted} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: radius.pill, overflow: 'hidden' },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  label: { minWidth: 150, minHeight: minTouch, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
