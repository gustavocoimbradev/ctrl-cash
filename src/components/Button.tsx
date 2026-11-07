import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, glow, gradients, minTouch, radius, spacing, type } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  danger?: boolean;
  flex?: boolean;
}

export function Button({ label, onPress, variant = 'primary', icon, disabled, danger, flex }: Props) {
  const primary = variant === 'primary';
  const fg = primary ? colors.onPrimary : danger ? colors.expense : colors.text;
  const grad = danger ? gradients.expense : gradients.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: any) => [
        flex && { flex: 1 },
        primary && glow(danger ? colors.expense : colors.primary, 16, 0.35),
        { opacity: disabled ? 0.4 : pressed ? 0.85 : 1, borderRadius: radius.control },
      ]}
    >
      {({ hovered }: any) => (
        <View
          style={[
            s.base,
            variant === 'secondary' && { borderWidth: danger ? 1 : 0, borderColor: colors.expense, backgroundColor: hovered ? colors.surfaceAlt : colors.surface },
            variant === 'tertiary' && hovered && { backgroundColor: colors.surface },
          ]}
        >
          {primary && <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
          {/* hover: just a deeper tone over the background (no elevation or scale) */}
          {primary && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#0B192C', opacity: hovered ? 0.14 : 0 }, Platform.OS === 'web' && ({ transitionProperty: 'opacity', transitionDuration: '180ms' } as object)]} />}
          {icon && <Feather name={icon} size={18} color={fg} />}
          <Text style={[type.label, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    minHeight: minTouch,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
});
