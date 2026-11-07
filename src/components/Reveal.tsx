import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleProp, ViewStyle } from 'react-native';
import { motion, useReducedMotion } from '../theme/motion';

interface Props {
  children: React.ReactNode;
  /** position in the sequence: delays by `index * stagger` ms */
  index?: number;
  /** initial vertical offset (px); negative enters from above */
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/** Soft entrance: fade + short slide, with staggered delay. Runs once on mount. */
export function Reveal({ children, index = 0, distance = 14, duration = motion.base + 60, style }: Props) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration, delay: index * motion.stagger, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, index, duration, reduced]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}
