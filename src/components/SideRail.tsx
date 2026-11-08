import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { glow, radius, spacing, type, useColors } from '../theme';

export interface RailItem {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}

const COLLAPSED = 64;
const EXPANDED = 200;

/**
 * The desktop menu: a slim floating card on the left edge, centered vertically, with an icon per place. Hovering it (or
 * focusing an item) opens it and shows the name of every item at once; the name is also each button's accessible label.
 */
export function SideRail({ items }: { items: RailItem[] }) {
  const c = useColors();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const open = hover || focus;
  const rail = useRef<any>(null);
  // hover straight from the DOM (mouseenter/leave do not bubble from the items inside, so it cannot flicker), and a short
  // delay when leaving so a pointer skimming the edge does not close and reopen it
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = rail.current as unknown as HTMLElement | null;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const enter = () => {
      if (timer) clearTimeout(timer);
      setHover(true);
    };
    const leave = () => {
      timer = setTimeout(() => setHover(false), 140);
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
    };
  }, []);
  return (
    <View pointerEvents="box-none" style={s.holder}>
      <View
        ref={rail}
        style={[
          s.rail,
          glow('#1E2950', 28, 0.5),
          { backgroundColor: c.card, borderColor: c.border, width: open ? EXPANDED : COLLAPSED },
          Platform.OS === 'web' && ({ transitionProperty: 'width', transitionDuration: '180ms', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } as object),
        ]}
      >
        {items.map((it) => (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            accessibilityLabel={it.label}
            accessibilityState={{ selected: !!it.active }}
            onPress={it.onPress}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            style={({ pressed, hovered }: any) => [s.item, { backgroundColor: it.active ? `${c.primary}1A` : hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={s.iconBox}>
              <Feather name={it.icon} size={22} color={it.active ? c.primary : c.textMuted} />
            </View>
            {open ? <Text style={[type.label, { color: it.active ? c.primary : c.text }]} numberOfLines={1}>{it.label}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /** fills the height; only the card itself takes touches */
  holder: { position: 'absolute', left: spacing.lg, top: 0, bottom: 0, justifyContent: 'center', zIndex: 15 },
  rail: { padding: spacing.sm, gap: spacing.xs, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  item: { height: 48, borderRadius: radius.control, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  iconBox: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
