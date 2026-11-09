import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors as c, glow, radius, spacing, type } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { useInstallBannerHeight } from '../theme/viewport';
import { t } from '../i18n';

export interface MenuItem {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** replaces the icon (for a brand mark) */
  iconNode?: React.ReactNode;
}

/**
 * The phone's menu: a panel that slides in from a side edge with the places that are not on the bottom bar. Tapping an item
 * closes the panel and goes there; the dimmed area (or the X) closes it too.
 */
export function MenuDrawer({ visible, onClose, header, items, side = 'right' }: { visible: boolean; onClose: () => void; header?: React.ReactNode; items: MenuItem[]; /** the edge it slides in from */ side?: 'left' | 'right' }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const panelW = Math.min(320, width * 0.86);
  /** the install banner at the top of phones stays above the menu */
  const bannerH = useInstallBannerHeight();

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduced) enter.setValue(1);
      else {
        enter.setValue(0);
        Animated.timing(enter, { toValue: 1, duration: 280, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
      }
    } else if (mounted) {
      if (reduced) {
        enter.setValue(0);
        setMounted(false);
      } else {
        Animated.timing(enter, { toValue: 0, duration: motion.base, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => finished && setMounted(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, marginTop: bannerH }}>
        <Pressable accessibilityLabel={t('Close menu')} style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: enter }, Platform.OS === 'web' && ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as object)]} />
        </Pressable>
        <Animated.View style={[s.panel, side === 'left' ? s.panelLeft : s.panelRight, glow('#1E2950', 40, 0.5), { width: panelW, opacity: enter.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [panelW * 0.35 * (side === 'left' ? -1 : 1), 0] }) }] }]}>
          <View style={s.head}>
            <View style={{ flex: 1, minWidth: 0 }}>{header}</View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Close menu')} onPress={onClose} style={s.close}>
              <Feather name="x" size={22} color={c.textMuted} />
            </Pressable>
          </View>
          <View style={{ gap: spacing.xs, padding: spacing.md }}>
            {items.map((it) => (
              <Pressable
                key={it.key}
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  it.onPress();
                }}
                style={({ pressed }) => [s.item, { backgroundColor: pressed ? c.surface : 'transparent' }]}
              >
                <View style={[s.iconBox, { backgroundColor: it.danger ? `${c.expense}14` : c.surface }]}>
                  {it.iconNode ?? <Feather name={it.icon} size={20} color={it.danger ? c.expense : c.textMuted} />}
                </View>
                <Text style={[type.label, { color: it.danger ? c.expense : c.text }]}>{it.label}</Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, backgroundColor: c.card, overflow: 'hidden' },
  panelRight: { right: 0, borderTopLeftRadius: radius.card, borderBottomLeftRadius: radius.card },
  panelLeft: { left: 0, borderTopRightRadius: radius.card, borderBottomRightRadius: radius.card },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 72, paddingLeft: spacing.xl - 4, paddingRight: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  item: { minHeight: 56, borderRadius: radius.control, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
