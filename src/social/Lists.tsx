import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { radius, spacing, type, useColors } from '../theme';
import { Person, socialApi } from './api';
import { useSocial } from './SocialProvider';
import { Empty, Pill, PersonRow } from './parts';

const preview = (mine: boolean, body: string) => `${mine ? 'You: ' : ''}${body.replace(/\s+/g, ' ')}`;

/** The conversations, newest first, with what is unread. */
export function ChatsList({ onOpen, onFind }: { onOpen: (handle: string) => void; onFind: () => void }) {
  const c = useColors();
  const { conversations } = useSocial();
  if (conversations.length === 0) {
    return (
      <View style={{ alignItems: 'center' }}>
        <Empty icon="message-circle" text="No conversations yet. Follow someone who follows you back to start one." />
        <Pill label="Find people" icon="search" onPress={onFind} />
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.xs }}>
      {conversations.map((cv) => (
        <PersonRow
          key={cv.with.handle}
          person={cv.with}
          subtitle={preview(cv.last.mine, cv.last.body)}
          onPress={() => onOpen(cv.with.handle)}
          right={
            cv.unread > 0 ? (
              <View style={{ minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.body, { color: c.onPrimary, fontSize: 16, lineHeight: 20, fontWeight: '700' }]}>{cv.unread > 99 ? '99+' : cv.unread}</Text>
              </View>
            ) : null
          }
        />
      ))}
    </View>
  );
}

/** Search for people, and the lists of who I follow and who follows me. */
export function PeopleTab({ onOpen }: { onOpen: (handle: string) => void }) {
  const c = useColors();
  const { following, followers, follow, unfollow } = useSocial();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const term = q.trim().replace(/^@/, '');

  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      socialApi.search(term).then((r) => !stale && setResults(r.people)).catch(() => !stale && setResults([]));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [term]);

  const toggle = async (p: Person) => {
    setBusy(p.handle);
    try {
      await (p.relation.following ? unfollow(p.handle) : follow(p.handle));
      // the search results carry the relation: refresh them too
      if (term.length >= 2) setResults((await socialApi.search(term)).people);
    } finally {
      setBusy(null);
    }
  };
  const action = (p: Person) => (
    <Pill
      label={p.relation.following ? 'Following' : p.relation.followsMe ? 'Follow back' : 'Follow'}
      primary={!p.relation.following}
      disabled={busy === p.handle}
      onPress={() => void toggle(p)}
    />
  );
  const section = (title: string, list: Person[], empty: string) => (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: c.textMuted }]}>{title} · {list.length}</Text>
      {list.length === 0 ? <Text style={[type.body, { color: c.textMuted, paddingVertical: spacing.sm }]}>{empty}</Text> : null}
      {list.map((p) => (
        <PersonRow key={p.handle} person={p} subtitle={p.relation.mutual ? `@${p.handle} · follows you` : undefined} onPress={() => onOpen(p.handle)} right={action(p)} />
      ))}
    </View>
  );

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, minHeight: 48 }}>
        <Feather name="search" size={20} color={c.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or @handle"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search people"
          style={[type.body, { flex: 1, color: c.text, minHeight: 48 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        />
      </View>
      {results !== null ? (
        results.length === 0 ? (
          <Empty icon="search" text="Nobody found. Check the handle and try again." />
        ) : (
          <View style={{ gap: spacing.xs }}>
            {results.map((p) => (
              <PersonRow key={p.handle} person={p} onPress={() => onOpen(p.handle)} right={action(p)} />
            ))}
          </View>
        )
      ) : (
        <>
          {section('Following', following, 'You are not following anyone yet. Search above to find people.')}
          {section('Followers', followers, 'Nobody follows you yet.')}
        </>
      )}
    </View>
  );
}
