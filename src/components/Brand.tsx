import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

/** A keyboard key: thin even border, no fill, rounded corners (no heavy base, no hard shadow, no gray background). */
function Key({ label, size, color, border, borderWidth, fontFamily }: { label: string; size: number; color: string; border: string; borderWidth: number; fontFamily?: string }) {
  return (
    <View
      style={[
        s.key,
        { borderColor: border, borderWidth, borderRadius: Math.max(8, Math.round(size * 0.3)), paddingHorizontal: size * 0.32, paddingVertical: size * 0.06 },
      ]}
    >
      <Text style={[s.text, { color, fontSize: size, fontFamily }]}>{label}</Text>
    </View>
  );
}

/**
 * `Ctrl+Cash` logotype: two keys, "Ctrl" and "Cash", joined by a "+".
 * Text without an icon. In URLs and the like the name is `ctrlcash`.
 */
export function Brand({ size = 24, color = '#FFFFFF', borderColor, borderWidth = 1.5 }: { size?: number; color?: string; /** key border color (defaults to the text color) */ borderColor?: string; borderWidth?: number }) {
  const fontFamily = Platform.OS === 'web' ? 'Inter, system-ui, sans-serif' : undefined;
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Ctrl+Cash" style={s.row}>
      <Key label="Ctrl" size={size} color={color} border={borderColor ?? color} borderWidth={borderWidth} fontFamily={fontFamily} />
      <Text style={[s.text, { color, fontSize: size, fontFamily, marginHorizontal: size * 0.25 }]}>+</Text>
      <Key label="Cash" size={size} color={color} border={borderColor ?? color} borderWidth={borderWidth} fontFamily={fontFamily} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  key: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700', letterSpacing: 0.2 },
});
