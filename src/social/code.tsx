import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, spacing, type, useColors } from '../theme';
import { PersonDetail, socialApi } from './api';
import { Avatar } from './parts';
import { t } from '../i18n';

/** A code is 6 characters: digits and letters (no I or O, so nothing is mistaken for 1 or 0). */
export const CODE_LENGTH = 6;
export const CODE_RE = /^[0-9A-HJ-NP-Z]{6}$/;

/** What the person typed, made into the shape a code can have: upper case, only valid characters, at most 6. */
export const normalizeCode = (text: string) => text.toUpperCase().replace(/[^0-9A-HJ-NP-Z]/g, '').slice(0, CODE_LENGTH);

export type Lookup = { status: 'idle' } | { status: 'loading' } | { status: 'missing' } | { status: 'found'; person: PersonDetail };

/** Types a code, looks up who it belongs to as soon as it is complete. `reload` asks again (after sharing, say). */
export function useCodeLookup() {
  const [text, setTextRaw] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  const stale = useRef(0);

  const run = useCallback(async (code: string) => {
    const ticket = ++stale.current;
    setLookup({ status: 'loading' });
    try {
      const { person } = await socialApi.person(code);
      if (ticket === stale.current) setLookup({ status: 'found', person });
    } catch {
      if (ticket === stale.current) setLookup({ status: 'missing' });
    }
  }, []);

  const setText = useCallback(
    (text: string) => {
      const code = normalizeCode(text);
      setTextRaw(code);
      if (CODE_RE.test(code)) void run(code);
      else {
        stale.current++;
        setLookup({ status: 'idle' });
      }
    },
    [run],
  );
  const reload = useCallback(() => {
    if (CODE_RE.test(text)) void run(text);
  }, [text, run]);
  const clear = useCallback(() => setText(''), [setText]);
  return { text, setText, lookup, reload, clear };
}

/** The field where a code is typed. */
export function CodeInput({ value, onChange, autoFocus, placeholder, bare }: { value: string; onChange: (t: string) => void; autoFocus?: boolean; placeholder?: string; /** no own background (when it sits inside another box) */ bare?: boolean }) {
  const c = useColors();
  const ph = placeholder ?? t('Enter a code');
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.field, !bare && { backgroundColor: c.surface, borderColor: focused ? c.primary : 'transparent' }, bare && { borderColor: 'transparent' }]}>
      <Feather name="hash" size={20} color={c.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        placeholder={ph}
        placeholderTextColor={c.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={CODE_LENGTH + 4}
        accessibilityLabel={t('Code')}
        style={[type.label, s.input, { color: c.text, letterSpacing: value ? 3 : 0 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
      />
    </View>
  );
}

/** Who a typed code belongs to, so it can be confirmed; `actions` are the buttons under it. */
export function FoundPerson({ lookup, actions }: { lookup: Lookup; actions: (person: PersonDetail) => React.ReactNode }) {
  const c = useColors();
  if (lookup.status === 'idle') return null;
  if (lookup.status === 'loading') return <Text style={[type.body, { color: c.textMuted }]}>{t('Looking...')}</Text>;
  if (lookup.status === 'missing') return <Text style={[type.body, { color: c.expense }]}>{t('No one has this code. Check it and try again.')}</Text>;
  const p = lookup.person;
  return (
    <View style={[s.card, { backgroundColor: c.surface }]}>
      <View style={s.who}>
        <Avatar name={p.displayName} id={p.code} color={p.color} photo={p.photo} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.label, { color: c.text }]}>{p.displayName}</Text>
          <Text style={[type.body, { color: c.textMuted, letterSpacing: 2 }]}>{p.code}</Text>
        </View>
      </View>
      {p.self ? <Text style={[type.body, { color: c.textMuted }]}>{t('This is your own code.')}</Text> : <View style={s.actions}>{actions(p)}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5 },
  input: { flex: 1, minWidth: 0, minHeight: 44 },
  card: { borderRadius: radius.control, padding: spacing.md, gap: spacing.md },
  who: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
