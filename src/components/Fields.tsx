import React, { useState } from 'react';
import { StyleSheet, Platform, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { digitsToCents, formatMoney } from '../domain/money';
import { glow, minTouch, radius, spacing, type, useColors } from '../theme';

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.label, { color: c.text }]}>{label}</Text>
      {children}
      {error ? <Text style={[type.body, { color: c.expense }]}>{error}</Text> : null}
    </View>
  );
}

export function useInputStyle(invalid?: boolean, focused?: boolean) {
  const c = useColors();
  return StyleSheet.flatten([
    s.input,
    type.body,
    {
      // same pattern as login: discreet border, and on focus a blue border with a soft glow and white background
      backgroundColor: focused ? '#FFFFFF' : c.bg,
      color: c.text,
      borderColor: invalid ? c.expense : focused ? c.primary : 'rgba(15,27,51,0.12)',
    },
    focused && glow(invalid ? c.expense : c.primary, 10, 0.55),
    Platform.OS === 'web' && ({ outlineStyle: 'none', transitionProperty: 'border-color, background-color, box-shadow', transitionDuration: '160ms' } as unknown as ViewStyle),
  ]) as ViewStyle & TextStyle;
}

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export function TextField({ label, error, ...rest }: TextFieldProps) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} error={error}>
      <TextInput
        placeholderTextColor={c.textMuted}
        style={useInputStyle(!!error, focused)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
    </Field>
  );
}

interface MoneyProps {
  label: string;
  cents: number;
  onChange: (cents: number) => void;
  error?: string;
}

/** Money field: the user types only digits and the value forms from right to left. */
export function MoneyField({ label, cents, onChange, error }: MoneyProps) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} error={error}>
      <TextInput
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        inputMode="numeric"
        value={formatMoney(cents)}
        onChangeText={(t) => onChange(digitsToCents(t))}
        placeholderTextColor={c.textMuted}
        style={useInputStyle(!!error, focused)}
      />
    </Field>
  );
}

const s = StyleSheet.create({
  input: {
    minHeight: minTouch,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.control,
    borderWidth: 1.5,
  },
});
