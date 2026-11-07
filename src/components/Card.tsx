import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** kept for compatibility: in the light theme all cards share the same soft background */
  tone?: 'neutral' | 'income' | 'primary' | 'info';
  padded?: boolean;
}

/** Light card: very soft blue background, well-rounded corners, no border. */
export function Card({ children, style, padded = true }: Props) {
  return <View style={[s.card, padded && s.pad, style]}>{children}</View>;
}

const s = StyleSheet.create({
  card: { borderRadius: radius.card, backgroundColor: colors.card, overflow: 'hidden' },
  pad: { padding: spacing.xl - 4, gap: spacing.md },
});
