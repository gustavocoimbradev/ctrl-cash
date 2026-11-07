import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { motion, useReducedMotion } from '../theme/motion';
import { colors, desktopBreakpoint, glow, radius, spacing, type, useColors } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** pinned under the header: it does not scroll, only `children` do (summary and tabs above a long list) */
  fixed?: React.ReactNode;
}

/**
 * Modal: bottom sheet on mobile, centered dialog on desktop. Enters and **exits** with animation
 * (fade + slide + scale); during exit the content stays frozen as it was, so it does not
 * change or vanish abruptly while the dialog closes.
 */
export function Sheet({ visible, title, onClose, children, footer, fixed }: Props) {
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const snap = useRef({ title, children, footer, fixed });
  if (visible) snap.current = { title, children, footer, fixed };
  const view = visible ? { title, children, footer, fixed } : snap.current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduced) {
        enter.setValue(1);
        return;
      }
      enter.setValue(0);
      Animated.timing(enter, { toValue: 1, duration: 200, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
    } else if (mounted) {
      if (reduced) {
        enter.setValue(0);
        setMounted(false);
        return;
      }
      Animated.timing(enter, { toValue: 0, duration: motion.fast + 40, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const c = useColors();
  const { width } = useWindowDimensions();
  const desktop = width >= desktopBreakpoint;
  // generous inner space: 32px on desktop, 24px on mobile (the content never hugs the edges)
  const pad = desktop ? spacing.xxl : spacing.xl;
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={[s.overlay, desktop && s.center, Platform.OS === 'web' && ({ cursor: 'default' } as object)]} onPress={onClose}>
          {/* dimmed backdrop with blur (8px) */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: enter }, Platform.OS === 'web' && ({ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as object)]} />
          <Pressable
            onPress={() => {}}
            style={[s.wrap, glow('#1E2950', 40, 0.5), desktop ? s.panelDesktop : s.panelMobile, Platform.OS === 'web' && ({ cursor: 'default' } as object)]}
          >
          <Animated.View style={{ maxHeight: '100%', opacity: enter, transform: desktop ? [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] : [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }}>
          <View style={[s.panel, { backgroundColor: c.card }]}>
            <View style={[s.header, { paddingHorizontal: pad, paddingTop: pad - 4 }]}>
              <Text style={[type.title, { color: c.text, flex: 1 }]}>{view.title}</Text>
              <Pressable accessibilityLabel="Close" onPress={onClose} style={s.close}>
                <Feather name="x" size={22} color={c.textMuted} />
              </Pressable>
            </View>
            {view.fixed ? <View style={[s.fixed, { paddingHorizontal: pad, borderColor: c.border }]}>{view.fixed}</View> : null}
            <ScrollView
              ref={scroller}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[s.body, { paddingHorizontal: pad, paddingBottom: pad }, view.fixed ? { paddingTop: spacing.lg } : null]}
            >
              {view.children}
            </ScrollView>
            {view.footer && <View style={[s.footer, { borderColor: c.border, paddingHorizontal: pad, paddingVertical: spacing.lg }]}>{view.footer}</View>}
          </View>
          </Animated.View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  center: { justifyContent: 'center', alignItems: 'center' },
  wrap: { borderRadius: radius.card },
  gradBorder: { padding: 1, borderRadius: radius.card, maxHeight: '100%' },
  panel: { overflow: 'hidden', borderRadius: radius.card - 1, maxHeight: '100%' },
  panelMobile: { width: '100%', maxHeight: '92%', borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  panelDesktop: { width: 620, maxWidth: '94%', maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.md },
  /** 44px touch target; pulled out so the icon itself sits on the content's right edge */
  close: { width: 44, height: 44, marginRight: -spacing.sm, alignItems: 'center', justifyContent: 'center' },
  body: { paddingTop: spacing.sm, gap: spacing.lg },
  /** the part that stays put: it never shrinks, the list below it scrolls */
  fixed: { gap: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, flexShrink: 0 },
  footer: { borderTopWidth: 1, flexDirection: 'row', gap: spacing.md },
});
