import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

/**
 * `Ctrl+Cash` brand: the app icon (the rounded key with the C) followed by the name, like the install bar.
 * `size` is the font size of the name; the icon is a little taller than the text. In URLs and the like the name
 * is `ctrlcash`.
 */
export function Brand({ size = 24, color = '#FFFFFF' }: { size?: number; color?: string }) {
  const fontFamily = Platform.OS === 'web' ? 'Inter, system-ui, sans-serif' : undefined;
  const icon = Math.round(size * 1.6);
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Ctrl+Cash" style={[s.row, { gap: size * 0.45 }]}>
      <Image source={require('../../assets/icon.png')} style={{ width: icon, height: icon, borderRadius: Math.round(icon * 0.26) }} accessibilityIgnoresInvertColors />
      <Text style={[s.text, { color, fontSize: size, fontFamily }]}>Ctrl+Cash</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { fontWeight: '700', letterSpacing: -0.2 },
});
