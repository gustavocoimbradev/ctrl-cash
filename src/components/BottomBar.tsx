import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { colors as c, spacing } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { Reveal } from './Reveal';

export type MobileTab = 'summary' | 'projection' | 'transactions' | 'cards';

/** Five equal slots: two tabs, the + in the center, two tabs (the + is not a tab). */
const SLOTS: ({ key: MobileTab; icon: keyof typeof Feather.glyphMap; label: string } | 'add')[] = [
  { key: 'summary', icon: 'pie-chart', label: 'Summary' },
  { key: 'projection', icon: 'trending-up', label: 'Projection' },
  'add',
  { key: 'transactions', icon: 'list', label: 'Transactions' },
  { key: 'cards', icon: 'credit-card', label: 'Cards' },
];

/** side padding of the bar (same margin as the content) and vertical padding */
const PADX = spacing.lg;
const PADY = 6;
/** diameter of the buttons and the highlight: always perfect circles */
const SIZE = 48;

/**
 * Bottom bar for phones, light and docked to the screen edge like the top bar (white, one hairline,
 * no shadow, no dark fill): four icon tabs with the + button perfectly centered, and a soft tinted
 * circle that slides to the active tab. Muted icons, the active one in the accent color.
 */
export function BottomBar({ tab, onChange, onAdd }: { tab: MobileTab; onChange: (t: MobileTab) => void; onAdd: () => void }) {
  const reduced = useReducedMotion();
  const slot = SLOTS.findIndex((x) => x !== 'add' && x.key === tab);
  const pos = useRef(new Animated.Value(slot)).current;
  const [ready, setReady] = useState(false);
  const [barW, setBarW] = useState(0);
  // each slot has the same width (the bar fills the full width); the highlight is a circle centered on the active slot
  const slotW = barW > 0 ? (barW - PADX * 2) / SLOTS.length : 0;
  useEffect(() => {
    if (reduced || !ready) {
      pos.setValue(slot);
      setReady(true);
      return;
    }
    Animated.timing(pos, { toValue: slot, duration: motion.base, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [slot, pos, reduced, ready]);
  const translateX = pos.interpolate({ inputRange: SLOTS.map((_, i) => i), outputRange: SLOTS.map((_, i) => i * slotW + (slotW - SIZE) / 2) });

  return (
    <View pointerEvents="box-none" style={s.wrap}>
      <Reveal distance={16} duration={320} style={{ alignSelf: 'stretch' }}>
        <View style={s.bar} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
          {slotW > 0 && <Animated.View pointerEvents="none" style={[s.pill, { transform: [{ translateX }] }]} />}
          {SLOTS.map((it, i) =>
            it === 'add' ? (
              <View key="add" style={s.item}>
                <Pressable accessibilityRole="button" accessibilityLabel="New transaction" onPress={onAdd} style={({ pressed }) => [s.add, { opacity: pressed ? 0.8 : 1 }]}>
                  <Feather name="plus" size={24} color={c.onPrimary} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                key={it.key}
                accessibilityRole="tab"
                accessibilityLabel={it.label}
                accessibilityState={{ selected: it.key === tab }}
                onPress={() => onChange(it.key)}
                style={({ pressed }) => [s.item, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name={it.icon} size={24} color={it.key === tab ? c.primary : c.textMuted} />
              </Pressable>
            ),
          )}
        </View>
      </Reveal>
    </View>
  );
}

const s = StyleSheet.create({
  /** docked to the bottom edge, full width, like the top bar */
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 },
  bar: {
    flexDirection: 'row',
    backgroundColor: c.card,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: PADX,
    paddingTop: PADY,
    // leaves room for the phone's home indicator on the web (iOS safe area)
    ...(Platform.OS === 'web' ? ({ paddingBottom: 'calc(6px + env(safe-area-inset-bottom))' } as object) : { paddingBottom: PADY + 4 }),
  },
  pill: { position: 'absolute', top: PADY, left: PADX, width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: `${c.primary}1A` },
  item: { flex: 1, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  add: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
});
