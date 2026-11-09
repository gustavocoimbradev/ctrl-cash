import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleProp, Text, TextProps, TextStyle, View, ViewStyle } from 'react-native';
import { formatMoneyShort } from '../domain/money';
import { colors as c } from '../theme';
import { motion, useReducedMotion, useTween } from '../theme/motion';

/** Money value that counts up to the new value (cents). */
export function Money({ cents, style, ...rest }: { cents: number; style?: StyleProp<TextStyle> } & Omit<TextProps, 'style'>) {
  const v = useTween(cents);
  return (
    <Text style={style} {...rest}>
      {formatMoneyShort(Math.round(v))}
    </Text>
  );
}

/** Integer that counts up to the new value. */
export function Counter({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const v = useTween(value);
  return <Text style={style}>{Math.round(v)}</Text>;
}

/** Progress bar (0 to 1) whose width grows smoothly. */
export function AnimatedBar({ ratio, color, track = c.surfaceAlt, height = 8 }: { ratio: number; color: string; track?: string; height?: number }) {
  const w = useTween(Math.max(0, Math.min(1, ratio)) * 100, motion.slow);
  return (
    <View style={{ flex: 1, height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: track }}>
      <View style={{ width: `${w}%`, height: '100%', borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/** Loading block that pulses slowly. */
export function Skeleton({ height = 120, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0, duration: 900, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduced]);
  return <Animated.View style={[{ height, borderRadius: 24, backgroundColor: c.surfaceAlt, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) }, style]} />;
}
