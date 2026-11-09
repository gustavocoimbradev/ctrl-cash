import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { radius, spacing, type, useColors } from '../theme';
import { ListedPerson, socialApi } from './api';
import { Avatar, Pill } from './parts';

/**
 * Starting a conversation: everybody on the platform in a list, the people I already talk to or share with first, and a search
 * that finds somebody by part of their name or by their code. Tapping a person starts (or reopens) the chat.
 */
export function People({ onPick }: { onPick: (code: string) => void }) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<ListedPerson[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [focused, setFocused] = useState(false);
  const ticket = useRef(0);

  const load = useCallback(async (q: string, offset: number) => {
    const mine = ++ticket.current;
    if (offset === 0) setState('loading');
    try {
      const res = await socialApi.people(q.trim(), offset);
      if (mine !== ticket.current) return;
      setPeople((old) => (offset === 0 ? res.people : [...old, ...res.people]));
      setMore(res.more);
      setState('ready');
    } catch {
      if (mine === ticket.current) setState('failed');
    }
  }, []);

  // a search starts a moment after the last key
  useEffect(() => {
    const timer = setTimeout(() => void load(query, 0), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  const known = people.filter((p) => p.related);
  const rest = people.filter((p) => !p.related);
  const row = (p: ListedPerson) => (
    <Pressable
      key={p.code}
      accessibilityRole="button"
      accessibilityLabel={t('Chat with {name}', { name: p.displayName })}
      onPress={() => onPick(p.code)}
      style={({ pressed, hovered }: any) => [s.row, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }, Platform.OS === 'web' && ({ cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '120ms' } as object)]}
    >
      <Avatar name={p.displayName} id={p.code} color={p.color} photo={p.photo} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{p.displayName}</Text>
        <Text style={[type.body, { color: c.textMuted, letterSpacing: 2 }]}>{p.code}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[s.field, { backgroundColor: c.surface, borderColor: focused ? c.primary : 'transparent' }]}>
        <Feather name="search" size={20} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
          placeholder={t('Search by name or code')}
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
          accessibilityLabel={t('Search people')}
          style={[type.body, s.input, { color: c.text }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Clear')} onPress={() => setQuery('')} style={s.clear}>
            <Feather name="x" size={18} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {state === 'loading' && people.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('Looking...')}</Text> : null}
      {state === 'failed' ? <Text style={[type.body, { color: c.expense }]}>{t('Could not load the list. Try again.')}</Text> : null}
      {state === 'ready' && people.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('Nobody found. Try another name or a code.')}</Text> : null}

      {known.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={[type.body, { color: c.textMuted, paddingHorizontal: spacing.sm }]}>{t('People you know')}</Text>
          {known.map(row)}
        </View>
      ) : null}
      {rest.length > 0 ? (
        <View style={{ gap: 2 }}>
          {known.length > 0 ? <Text style={[type.body, { color: c.textMuted, paddingHorizontal: spacing.sm, paddingTop: spacing.sm }]}>{t('Everyone')}</Text> : null}
          {rest.map(row)}
        </View>
      ) : null}
      {more ? <Pill label={t('Show more')} onPress={() => void load(query, people.length)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5 },
  input: { flex: 1, minWidth: 0, minHeight: 44 },
  clear: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.sm, borderRadius: radius.control },
});
