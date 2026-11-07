import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addMonthsToKey, daysInMonth, formatDate, monthKey, monthLabel, parseISO, toISO, todayISO } from '../domain/dates';
import { colors, glow, minTouch, radius, spacing, type } from '../theme';
import { Button } from './Button';
import { Field, useInputStyle } from './Fields';
import { Sheet } from './Sheet';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  label: string;
  /** ISO YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  error?: string;
}

/** Date field with a styled calendar (never the native picker). */
export function DateField({ label, value, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(monthKey(value));
  const inputStyle = useInputStyle(!!error, open);

  useEffect(() => {
    if (open) setView(monthKey(value));
  }, [open, value]);

  const [y, m] = view.split('-').map(Number);
  const offset = new Date(y, m - 1, 1).getDay();
  const total = daysInMonth(y, m);
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const today = todayISO();

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <Field label={label} error={error}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [inputStyle, s.trigger, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[type.body, { color: colors.text, flex: 1 }]}>{formatDate(value)}</Text>
        <Feather name="calendar" size={20} color={colors.textMuted} />
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={s.nav}>
          <NavButton icon="chevrons-left" label="Previous year" onPress={() => setView(addMonthsToKey(view, -12))} />
          <NavButton icon="chevron-left" label="Previous month" onPress={() => setView(addMonthsToKey(view, -1))} />
          <Text style={[type.label, { color: colors.text, flex: 1, textAlign: 'center' }]}>{monthLabel(view)}</Text>
          <NavButton icon="chevron-right" label="Next month" onPress={() => setView(addMonthsToKey(view, 1))} />
          <NavButton icon="chevrons-right" label="Next year" onPress={() => setView(addMonthsToKey(view, 12))} />
        </View>
        <View style={s.grid}>
          {WEEKDAYS.map((w, i) => (
            <View key={`w${i}`} style={s.cell}>
              <Text style={[type.body, { color: colors.textMuted }]}>{w}</Text>
            </View>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <View key={`e${i}`} style={s.cell} />;
            const iso = toISO(y, m, d);
            const selected = iso === value;
            const isToday = iso === today;
            return (
              <View key={iso} style={s.cell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(iso)}
                  onPress={() => pick(iso)}
                  style={({ pressed, hovered }: any) => [
                    s.day,
                    isToday && !selected && { borderColor: colors.primary },
                    hovered && !selected && { backgroundColor: colors.surfaceAlt },
                    selected && { backgroundColor: colors.primary, borderColor: colors.primary, ...glow(colors.primary, 12, 0.5) },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[type.body, { color: selected ? '#FFFFFF' : colors.text, fontWeight: selected ? '700' : '400' }]}>{d}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Button label="Today" variant="secondary" icon="calendar" onPress={() => pick(today)} />
      </Sheet>
    </Field>
  );
}

function NavButton({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered }: any) => [s.navBtn, { backgroundColor: hovered ? colors.surfaceAlt : 'transparent', opacity: pressed ? 0.5 : 1 }]}
    >
      <Feather name={icon} size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nav: { flexDirection: 'row', alignItems: 'center' },
  navBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: minTouch, alignItems: 'center', justifyContent: 'center' },
  day: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
});
