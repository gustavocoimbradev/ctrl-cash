import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '../components/Card';
import { Select } from '../components/Select';
import { buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { desktopBreakpoint, maxContentWidth, spacing, type, useColors } from '../theme';
import { PersonDetail, Summary, socialApi } from './api';
import { ProfileForm } from './ProfileForm';
import { useSocial } from './SocialProvider';
import { SummaryView } from './SummaryView';
import { Avatar, Empty, Pill, PersonRow } from './parts';

const Count = ({ n, label }: { n: number; label: string }) => {
  const c = useColors();
  return (
    <View style={{ minWidth: 72 }}>
      <Text style={[type.title, { color: c.text }]}>{n}</Text>
      <Text style={[type.body, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
};

/** The top card of a profile: who it is, the numbers and the actions. */
function Header({ name, handle, color, bio, followers, following, actions }: { name: string; handle: string; color: string | null; bio: string | null; followers: number; following: number; actions?: React.ReactNode }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;
  return (
    <Card style={[s.head, wide && s.headWide]}>
      <Avatar name={name} handle={handle} color={color} size={wide ? 104 : 88} />
      <View style={[s.headInfo, !wide && { alignItems: 'center' }]}>
        <View style={wide ? undefined : { alignItems: 'center' }}>
          <Text style={[type.hero, { color: c.text, fontSize: 28 }]} numberOfLines={2}>{name}</Text>
          <Text style={[type.body, { color: c.textMuted }]}>@{handle}</Text>
        </View>
        {bio ? <Text style={[type.body, { color: c.text }, !wide && { textAlign: 'center' }]}>{bio}</Text> : null}
        <View style={{ flexDirection: 'row', gap: spacing.xl }}>
          <Count n={followers} label="Followers" />
          <Count n={following} label="Following" />
        </View>
      </View>
      {actions ? <View style={[s.actions, !wide && { justifyContent: 'center' }]}>{actions}</View> : null}
    </Card>
  );
}

/** Lets the owner choose who can read the summary: only people who follow each other, and every grant can be taken back. */
function ShareCard() {
  const c = useColors();
  const { following, followers, given, share, revoke } = useSocial();
  const [pick, setPick] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const mutual = useMemo(() => following.filter((p) => followers.some((f) => f.handle === p.handle)), [following, followers]);
  const options = mutual.filter((p) => !given.some((g) => g.handle === p.handle)).map((p) => ({ value: p.handle, label: `${p.displayName} (@${p.handle})` }));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text style={[type.title, { color: c.text }]}>Share summary</Text>
      <Text style={[type.body, { color: c.textMuted }]}>
        Only people you follow and who follow you back can be given access. They see your summary (never single transactions) when they open your profile. You can stop sharing at any time.
      </Text>
      {given.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.label, { color: c.text }]}>Sharing with</Text>
          {given.map((p) => (
            <PersonRow key={p.handle} person={p} right={<Pill label="Stop sharing" danger disabled={busy} onPress={() => void run(() => revoke(p.handle))} />} />
          ))}
        </View>
      ) : null}
      {options.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <Select label="Share with" value={pick} options={options} onChange={setPick} placeholder="Choose a person" />
          <Pill label="Share summary" icon="share-2" primary disabled={!pick || busy} onPress={() => pick && void run(async () => { await share(pick); setPick(undefined); })} />
        </View>
      ) : (
        <Text style={[type.body, { color: c.textMuted }]}>{mutual.length === 0 ? 'Follow people who follow you back to be able to share with them.' : 'You are already sharing with everyone who follows you back.'}</Text>
      )}
    </Card>
  );
}

/** Who I follow and who follows me. */
function ConnectionsCard({ onOpen }: { onOpen: (h: string) => void }) {
  const c = useColors();
  const { following, followers } = useSocial();
  const list = (title: string, people: typeof following, empty: string) => (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: c.textMuted }]}>{title} · {people.length}</Text>
      {people.length === 0 ? <Text style={[type.body, { color: c.textMuted, paddingVertical: spacing.xs }]}>{empty}</Text> : null}
      {people.map((p) => <PersonRow key={p.handle} person={p} subtitle={p.relation.mutual ? `@${p.handle} · mutual` : undefined} onPress={() => onOpen(p.handle)} />)}
    </View>
  );
  return (
    <Card>
      <Text style={[type.title, { color: c.text }]}>Connections</Text>
      {list('Following', following, 'You are not following anyone yet. Find people in the chat.')}
      {list('Followers', followers, 'Nobody follows you yet.')}
    </Card>
  );
}

function OwnProfile({ email, onOpen }: { email: string; onOpen: (h: string) => void }) {
  const c = useColors();
  const { profile, counts } = useSocial();
  const { data } = useStore();
  const [editing, setEditing] = useState(false);
  const summary = useMemo<Summary>(() => buildSummary(data), [data]);
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;

  if (!profile || editing) {
    return (
      <Card style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.title, { color: c.text }]}>{profile ? 'Edit profile' : 'Create your profile'}</Text>
        <ProfileForm email={email} existing={profile} onDone={() => setEditing(false)} />
        {profile ? <Pill label="Cancel" onPress={() => setEditing(false)} /> : null}
      </Card>
    );
  }
  return (
    <View style={{ gap: spacing.lg }}>
      <Header name={profile.displayName} handle={profile.handle} color={profile.color} bio={profile.bio} followers={counts.followers} following={counts.following} actions={<Pill label="Edit profile" icon="edit-2" onPress={() => setEditing(true)} />} />
      <View style={[s.cols, wide && s.colsWide]}>
        <Card style={[s.col, wide && { flex: 1.3 }]}>
          <Text style={[type.title, { color: c.text }]}>Your summary</Text>
          <Text style={[type.body, { color: c.textMuted }]}>Only you see this, unless you share it.</Text>
          <SummaryView summary={summary} />
        </Card>
        <View style={[s.col, { gap: spacing.lg }, wide && { flex: 1 }]}>
          <ShareCard />
          <ConnectionsCard onOpen={onOpen} />
        </View>
      </View>
    </View>
  );
}

function OtherProfile({ handle }: { handle: string }) {
  const c = useColors();
  const { follow, unfollow, openChat } = useSocial();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [summary, setSummary] = useState<{ summary: Summary | null; updatedAt: number | null } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { person: p } = await socialApi.person(handle);
      setPerson(p);
      setSummary(p.summaryAccess ? await socialApi.summaryOf(handle).catch(() => null) : null);
    } catch {
      setMissing(true);
    }
  }, [handle]);
  useEffect(() => {
    setPerson(null);
    setMissing(false);
    void load();
  }, [load]);

  if (missing) return <Card><Empty icon="user-x" text="This person could not be found." /></Card>;
  if (!person) return null;
  const { relation } = person;
  const toggle = async () => {
    setBusy(true);
    try {
      await (relation.following ? unfollow(handle) : follow(handle));
      await load();
    } finally {
      setBusy(false);
    }
  };
  const first = person.displayName.split(' ')[0];
  return (
    <View style={{ gap: spacing.lg }}>
      <Header
        name={person.displayName}
        handle={person.handle}
        color={person.color}
        bio={person.bio}
        followers={person.followers}
        following={person.following}
        actions={
          <>
            <Pill label={relation.following ? 'Following' : relation.followsMe ? 'Follow back' : 'Follow'} icon={relation.following ? 'check' : 'user-plus'} primary={!relation.following} disabled={busy} onPress={toggle} />
            {relation.mutual ? <Pill label="Message" icon="message-circle" onPress={() => openChat(handle)} /> : null}
          </>
        }
      />
      {summary?.summary ? (
        <Card style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <Text style={[type.title, { color: c.text }]}>{first}'s summary</Text>
          <SummaryView summary={summary.summary} updatedAt={summary.updatedAt} />
        </Card>
      ) : (
        <Card>
          <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>
            {person.summaryAccess ? `${first} shared the summary, but it has not been published yet.` : relation.mutual ? `${first} has not shared a summary with you.` : 'Follow each other to chat and to share summaries.'}
          </Text>
        </Card>
      )}
    </View>
  );
}

/** A profile, as a page of its own: yours (summary, sharing and connections) or somebody else's. */
export function ProfilePage({ handle, email, onBack, onOpen }: { handle: string | 'me'; email: string; onBack: () => void; onOpen: (handle: string) => void }) {
  const c = useColors();
  return (
    <View style={s.page}>
      <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed, hovered }: any) => [s.back, { opacity: pressed ? 0.6 : 1, backgroundColor: hovered ? c.surface : 'transparent' }]}>
        <Feather name="arrow-left" size={20} color={c.textMuted} />
        <Text style={[type.label, { color: c.textMuted }]}>Back</Text>
      </Pressable>
      {handle === 'me' ? <OwnProfile email={email} onOpen={onOpen} /> : <OtherProfile handle={handle} />}
    </View>
  );
}

const s = StyleSheet.create({
  page: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', gap: spacing.md },
  back: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  head: { gap: spacing.lg, alignItems: 'center' },
  headWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, padding: spacing.xl },
  headInfo: { flex: 1, minWidth: 0, gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cols: { gap: spacing.lg },
  colsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { minWidth: 0 },
});
