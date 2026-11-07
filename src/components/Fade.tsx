import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleProp, ViewStyle } from 'react-native';
import { motion, useReducedMotion } from '../theme/motion';

interface Props {
  /** on change, the content enters with a short fade and a slight slide */
  id: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Subtle transition between states: opacity and an 8px slide, no flicker. */
export function Fade({ id, children, style }: Props) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: motion.base, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [id, v, reduced]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}
