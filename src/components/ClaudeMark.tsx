import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { radius, spacing, type } from '../theme';

/** Claude's own colors, used wherever the app talks about Claude. */
export const CLAUDE = { orange: '#D97757', orangeDark: '#C4633F', cream: '#F6F1E7', ink: '#3D2B22' };

const RAYS = [46, 38, 44, 36, 46, 40, 44, 36, 46, 38, 44, 40];

/** Claude's spark: a ring of rounded rays of different lengths. */
export function ClaudeMark({ size = 20, color = CLAUDE.orange }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {RAYS.map((len, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return <Line key={i} x1={50 + Math.sin(a) * 12} y1={50 - Math.cos(a) * 12} x2={50 + Math.sin(a) * len} y2={50 - Math.cos(a) * len} stroke={color} strokeWidth={9} strokeLinecap="round" />;
      })}
    </Svg>
  );
}

/** The button that connects Claude: terracotta, with the spark. */
export function ClaudeButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        s.btn,
        { backgroundColor: hovered ? CLAUDE.orangeDark : CLAUDE.orange, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '140ms', cursor: 'pointer' } as object),
      ]}
    >
      <ClaudeMark size={22} color="#FFFFFF" />
      <Text style={[type.label, { color: '#FFFFFF' }]}>{label}</Text>
    </Pressable>
  );
}

/** A round badge with the spark, on Claude's cream. */
export function ClaudeBadge({ size = 64 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: CLAUDE.cream, alignItems: 'center', justifyContent: 'center' }}>
      <ClaudeMark size={size * 0.5} />
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48, borderRadius: radius.pill, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
