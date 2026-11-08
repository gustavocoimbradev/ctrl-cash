import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { glow, radius, spacing, type, useColors } from '../theme';

export interface RailItem {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}

/**
 * The desktop menu: a slim floating card on the left edge, centered vertically, with an icon per place. The name shows in a small
 * tooltip beside the icon on hover (and is the accessible label), so the rail stays narrow and out of the way.
 */
export function SideRail({ items }: { items: RailItem[] }) {
  const c = useColors();
  return (
    <View pointerEvents="box-none" style={s.holder}>
      <View style={[s.rail, glow('#1E2950', 28, 0.5), { backgroundColor: c.card, borderColor: c.border }]}>
        {items.map((it) => (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            accessibilityLabel={it.label}
            accessibilityState={{ selected: !!it.active }}
            onPress={it.onPress}
            {...(Platform.OS === 'web' ? ({ title: it.label } as object) : null)}
            style={({ pressed, hovered }: any) => [s.item, { backgroundColor: it.active ? `${c.primary}1A` : hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name={it.icon} size={22} color={it.active ? c.primary : c.textMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /** fills the height under the top bar; only the card itself takes touches */
  holder: { position: 'absolute', left: spacing.lg, top: 0, bottom: 0, justifyContent: 'center', zIndex: 15 },
  rail: { padding: spacing.sm, gap: spacing.xs, borderRadius: radius.card, borderWidth: 1 },
  item: { width: 48, height: 48, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
});
