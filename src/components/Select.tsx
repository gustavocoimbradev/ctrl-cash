import { Feather } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, glow, minTouch, radius, spacing, type, useColors } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { Field, useInputStyle } from './Fields';
import { t } from '../i18n';

export interface Option<T extends string | number> {
  value: T;
  label: string;
  /** a heading the option is listed under; consecutive options with the same group share one heading */
  group?: string;
}

interface Props<T extends string | number> {
  label: string;
  value: T | undefined;
  options: Option<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  error?: string;
}

interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_LIST = 300;
const GAP = 6;
const MARGIN = 12;

/**
 * Custom select with search (never the native select). The list opens as a floating
 * dropdown, anchored right below the field (or above, if space is short), without covering
 * the dialog the field is in.
 */
export function Select<T extends string | number>({ label, value, options, onChange, placeholder, error }: Props<T>) {
  const c = useColors();
  const { height: winH } = useWindowDimensions();
  const trigger = useRef<any>(null);
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [query, setQuery] = useState('');
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    if (reduced) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: motion.fast + 30, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [open, enter, reduced]);
  const inputStyle = useInputStyle(!!error, open);
  const searchStyle = useInputStyle(false, true);
  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const show = () => trigger.current?.measureInWindow((x: number, y: number, w: number, h: number) => setAnchor({ x, y, w, h }));
  const close = () => {
    setAnchor(null);
    setQuery('');
  };

  // space below and above the field; opens toward the side with more room
  const below = anchor ? winH - (anchor.y + anchor.h) - GAP - MARGIN : 0;
  const above = anchor ? anchor.y - GAP - MARGIN : 0;
  const openUp = !!anchor && below < 220 && above > below;
  const panelMax = Math.max(160, Math.min(MAX_LIST + 64, openUp ? above : below));

  return (
    <Field label={label} error={error}>
      <Pressable
        ref={trigger}
        collapsable={false}
        accessibilityRole="combobox"
        accessibilityState={{ expanded: open }}
        onPress={show}
        style={({ pressed }) => [inputStyle, s.trigger, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[type.body, { color: current ? c.text : c.textMuted, flex: 1 }]} numberOfLines={1}>
          {current?.label ?? placeholder ?? t('Select')}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={c.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('Close list')} />
        {anchor && (
          <Animated.View
            style={[
              s.panel,
              glow('#1E2950', 24, 0.5),
              {
                left: anchor.x,
                width: anchor.w,
                maxHeight: panelMax,
                backgroundColor: colors.card,
                borderColor: c.border,
              },
              openUp ? { bottom: winH - anchor.y + GAP } : { top: anchor.y + anchor.h + GAP },
              { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [openUp ? 6 : -6, 0] }) }] },
            ]}
          >
            <View style={{ padding: spacing.sm }}>
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder={t('Search')}
                placeholderTextColor={c.textMuted}
                style={[searchStyle, { minHeight: 44 }]}
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ padding: spacing.xs }}>
              {filtered.length === 0 && <Text style={[type.body, { color: c.textMuted, padding: spacing.md }]}>{t('Nothing found')}</Text>}
              {filtered.map((item, idx) => (
                <React.Fragment key={String(item.value)}>
                {item.group && item.group !== filtered[idx - 1]?.group ? (
                  <Text accessibilityRole="header" style={[type.body, { color: c.textMuted, opacity: 0.75, fontSize: 16, paddingHorizontal: spacing.md, paddingTop: idx === 0 ? spacing.xs : spacing.md, paddingBottom: 2 }]}>{item.group}</Text>
                ) : null}
                <Pressable
                  key={String(item.value)}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                  style={({ pressed, hovered }: any) => [s.item, { backgroundColor: pressed || hovered ? c.surfaceAlt : 'transparent' }]}
                >
                  <Text style={[type.body, { color: c.text, flex: 1 }]}>{item.label}</Text>
                  {item.value === value && <Feather name="check" size={20} color={c.primary} />}
                </Pressable>
                </React.Fragment>
              ))}
            </ScrollView>
          </Animated.View>
        )}
      </Modal>
    </Field>
  );
}

const s = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  panel: { position: 'absolute', borderRadius: radius.control, borderWidth: 1, overflow: 'hidden' },
  item: {
    minHeight: minTouch,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control - 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
