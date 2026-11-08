import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type, useColors } from '../theme';
import { Person } from './api';

/** The colors a profile can wear: all from the app's palette, so every avatar looks like it belongs. */
export const AVATAR_COLORS = ['#2D55D9', '#0EA5E9', '#8B5CF6', '#1FA86A', '#D9831F', '#E0446A'];

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const colorFor = (id: string, color?: string | null) => color ?? AVATAR_COLORS[hash(id) % AVATAR_COLORS.length];

/** A round avatar: the person's photo, or the initial on their color. */
export function Avatar({ name, id, color, photo, size = 44 }: { name: string; id: string; color?: string | null; photo?: string | null; size?: number }) {
  const tint = colorFor(id, color);
  if (photo) return <Image source={{ uri: photo }} accessibilityIgnoresInvertColors style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.label, { color: '#FFFFFF', fontSize: Math.max(16, Math.round(size * 0.42)) }]}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

/** One person in a list: avatar and name (and a line under it when there is something to say), with whatever sits on the right. */
export function PersonRow({ person, onPress, right, subtitle }: { person: Pick<Person, 'id' | 'displayName' | 'color' | 'photo'>; onPress?: () => void; right?: React.ReactNode; subtitle?: string }) {
  const c = useColors();
  // the row is not one big button: the person area opens the profile and `right` (a Follow button, say) stays its own
  // control, so there is never a button inside a button
  return (
    <View style={s.row}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed, hovered }: any) => [s.who, { backgroundColor: hovered && onPress ? 'rgba(15,27,51,0.03)' : 'transparent', opacity: pressed ? 0.7 : 1 }]}
      >
        <Avatar name={person.displayName} id={person.id} color={person.color} photo={person.photo} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{person.displayName}</Text>
          {subtitle ? <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </Pressable>
      {right}
    </View>
  );
}

/** A small text button for the panel (quiet by default; `primary` fills it with the brand blue). */
export function Pill({ label, icon, onPress, primary, danger, disabled }: { label: string; icon?: keyof typeof Feather.glyphMap; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  const c = useColors();
  const fg = primary ? c.onPrimary : danger ? c.expense : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: any) => [
        s.pill,
        { backgroundColor: primary ? c.primary : hovered ? c.surfaceAlt : c.surface, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '150ms' } as object),
      ]}
    >
      {icon ? <Feather name={icon} size={18} color={fg} /> : null}
      <Text style={[type.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Quiet empty state: an icon and a line. */
export function Empty({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  const c = useColors();
  return (
    <View style={s.empty}>
      <View style={[s.emptyIcon, { backgroundColor: c.surface }]}>
        <Feather name={icon} size={22} color={c.textMuted} />
      </View>
      <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.control },
  pill: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
