import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { glow, radius, spacing, type, useColors } from '../theme';
import { Person, socialApi } from './api';
import { useSocial } from './SocialProvider';
import { Pill, PersonRow } from './parts';

/**
 * Find people from the header (by name): a search field with a dropdown of results. Tapping a person opens the profile page;
 * the result row also has Follow. Without a profile of your own the dropdown points to creating one first.
 */
export function PeopleSearch({ onOpenProfile, autoFocus, onDone }: { onOpenProfile: (id: string | 'me') => void; autoFocus?: boolean; onDone?: () => void }) {
  const c = useColors();
  const { profile, follow, unfollow } = useSocial();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const term = q.trim().replace(/^@/, '');
  const open = focused && term.length >= 2;

  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      socialApi.search(term).then((r) => !stale && setResults(r.people)).catch(() => !stale && setResults([]));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [term]);

  const close = () => {
    setFocused(false);
    input.current?.blur();
  };
  const go = (id: string | 'me') => {
    close();
    setQ('');
    onOpenProfile(id);
    onDone?.();
  };
  const toggle = async (p: Person) => {
    setBusy(p.id);
    try {
      await (p.relation.following ? unfollow(p.id) : follow(p.id));
      setResults((await socialApi.search(term)).people);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={s.wrap}>
      {/* a click anywhere else closes the dropdown (web) */}
      {open && Platform.OS === 'web' ? <Pressable accessibilityLabel="Close search" onPress={close} style={s.backdrop} /> : null}
      <View style={[s.field, { backgroundColor: c.surface, borderColor: focused ? c.primary : 'transparent' }]}>
        <Feather name="search" size={20} color={c.textMuted} />
        <TextInput
          ref={input}
          value={q}
          onChangeText={setQ}
          onFocus={() => setFocused(true)}
          onKeyPress={(e: any) => Platform.OS === 'web' && e.nativeEvent.key === 'Escape' && close()}
          autoFocus={autoFocus}
          placeholder="Search people"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search people"
          style={[type.body, s.input, { color: c.text }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        />
        {q ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} style={s.clear}>
            <Feather name="x" size={18} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={[s.drop, glow('#1E2950', 30, 0.5), { backgroundColor: c.card, borderColor: c.border }]}>
          {results === null ? <Text style={[type.body, s.note, { color: c.textMuted }]}>Searching...</Text> : null}
          {results !== null && results.length === 0 ? <Text style={[type.body, s.note, { color: c.textMuted }]}>Nobody found. Check the name and try again.</Text> : null}
          {results?.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              onPress={() => go(p.id)}
              right={
                profile ? (
                  <Pill
                    label={p.relation.following ? 'Following' : p.relation.followsMe ? 'Follow back' : 'Follow'}
                    primary={!p.relation.following}
                    disabled={busy === p.id}
                    onPress={() => void toggle(p)}
                  />
                ) : undefined
              }
            />
          ))}
          {!profile && results && results.length > 0 ? (
            <View style={s.note}>
              <Text style={[type.body, { color: c.textMuted }]}>Create your profile to follow people.</Text>
              <Pill label="Create profile" icon="user" primary onPress={() => go('me')} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', position: 'relative', zIndex: 5 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1, ...(Platform.OS === 'web' ? ({ position: 'fixed' } as object) : null) },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingLeft: spacing.lg, paddingRight: spacing.xs, borderRadius: radius.pill, borderWidth: 1.5 },
  input: { flex: 1, minWidth: 0, minHeight: 44 },
  clear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  drop: { position: 'absolute', top: 52, left: 0, right: 0, borderRadius: radius.card - 6, borderWidth: 1, padding: spacing.sm, gap: spacing.xs, maxHeight: 420, overflow: 'hidden' },
  note: { padding: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
});
