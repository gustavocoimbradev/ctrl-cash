import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { radius, spacing, type, useColors } from '../theme';
import { ListedPerson, socialApi } from './api';
import { Avatar } from './parts';

/**
 * Starting a conversation: everybody on the platform in one list, loaded as you scroll (a page at a time), with the people I already
 * talk to or share with first, and a search that finds somebody by part of their name or by their code. Tapping a person starts (or
 * reopens) the chat.
 */
export function People({ onPick }: { onPick: (code: string) => void }) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<ListedPerson[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [focused, setFocused] = useState(false);
  const ticket = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async (q: string, offset: number) => {
    const mine = ++ticket.current;
    busy.current = true;
    if (offset === 0) setState('loading');
    try {
      const res = await socialApi.people(q.trim(), offset);
      if (mine !== ticket.current) return;
      setPeople((old) => (offset === 0 ? res.people : [...old, ...res.people.filter((p) => !old.some((o) => o.code === p.code))]));
      setMore(res.more);
      setState('ready');
    } catch {
      if (mine === ticket.current) setState('failed');
    } finally {
      if (mine === ticket.current) busy.current = false;
    }
  }, []);

  // a search starts a moment after the last key
  useEffect(() => {
    const timer = setTimeout(() => void load(query, 0), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  const next = () => {
    if (more && !busy.current && state === 'ready') void load(query, people.length);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
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
      </View>
      <FlatList
        data={people}
        keyExtractor={(p) => p.code}
        keyboardShouldPersistTaps="handled"
        onEndReached={next}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.lg }}
        ListEmptyComponent={
          state === 'loading' ? (
            <Text style={[type.body, { color: c.textMuted, padding: spacing.lg }]}>{t('Looking...')}</Text>
          ) : state === 'failed' ? (
            <Text style={[type.body, { color: c.expense, padding: spacing.lg }]}>{t('Could not load the list. Try again.')}</Text>
          ) : (
            <Text style={[type.body, { color: c.textMuted, padding: spacing.lg }]}>{t('Nobody found. Try another name or a code.')}</Text>
          )
        }
        ListFooterComponent={more ? <Text style={[type.body, { color: c.textMuted, textAlign: 'center', padding: spacing.md }]}>{t('Looking...')}</Text> : undefined}
        renderItem={({ item: p }) => (
          <Pressable
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
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5 },
  input: { flex: 1, minWidth: 0, minHeight: 44 },
  clear: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.sm, borderRadius: radius.control },
});
