import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '../components/Card';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { desktopBreakpoint, maxContentWidth, spacing, type, useColors } from '../theme';
import { Person, PersonDetail, Summary, socialApi } from './api';
import { ProfileForm } from './ProfileForm';
import { useSocial } from './SocialProvider';
import { SummaryView } from './SummaryView';
import { Avatar, Empty, Pill, PersonRow } from './parts';

/** A number under a label. With `onPress` it is a button (the lists behind the counters open in a dialog). */
const COUNT_PAD = 14;
const Count = ({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) => {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${label}: ${n}` : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        { minWidth: 88, minHeight: 56, paddingHorizontal: COUNT_PAD, paddingVertical: 8, borderRadius: 16, justifyContent: 'center', opacity: pressed ? 0.7 : 1, backgroundColor: hovered && onPress ? c.surface : 'transparent' },
        Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '150ms' } as object),
      ]}
    >
      <Text style={[type.title, { color: c.text, lineHeight: 26 }]}>{n}</Text>
      <Text style={[type.body, { color: c.textMuted, lineHeight: 22 }]}>{label}</Text>
    </Pressable>
  );
};

/** The top card of a profile: who it is, the numbers and the actions. */
function Header({ name, id, color, photo, followers, following, access, onCount, actions }: { name: string; id: string; color: string | null; photo?: string | null; followers: number; following: number; /** people who can read the summary (your own profile only) */ access?: number; onCount?: (kind: 'followers' | 'following' | 'access') => void; actions?: React.ReactNode }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;
  return (
    <Card style={[s.head, wide && s.headWide]}>
      <Avatar name={name} id={id} color={color} photo={photo} size={wide ? 104 : 88} />
      <View style={[s.headInfo, !wide && { alignItems: 'center' }]}>
        <View style={wide ? undefined : { alignItems: 'center' }}>
          <Text style={[type.hero, { color: c.text, fontSize: 28 }]} numberOfLines={2}>{name}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginLeft: wide ? -COUNT_PAD : 0 }}>
          <Count n={followers} label="Followers" onPress={onCount && (() => onCount('followers'))} />
          <Count n={following} label="Following" onPress={onCount && (() => onCount('following'))} />
          {access !== undefined ? <Count n={access} label="With access" onPress={onCount && (() => onCount('access'))} /> : null}
        </View>
      </View>
      {actions ? <View style={[s.actions, !wide && { justifyContent: 'center' }]}>{actions}</View> : null}
    </Card>
  );
}

/** Lets the owner choose who can read the summary: only people who follow each other, and every grant can be taken back. */
function ShareContent() {
  const c = useColors();
  const { following, followers, given, share, revoke } = useSocial();
  const [pick, setPick] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const mutual = useMemo(() => following.filter((p) => followers.some((f) => f.id === p.id)), [following, followers]);
  const options = mutual.filter((p) => !given.some((g) => g.id === p.id)).map((p) => ({ value: p.id, label: p.displayName }));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={[type.body, { color: c.textMuted }]}>
        Only people you follow and who follow you back can be given access. They see your summary (never single transactions) when they open your profile. You can stop sharing at any time.
      </Text>
      {given.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.label, { color: c.text }]}>Can see your summary · {given.length}</Text>
          {given.map((p) => (
            <PersonRow key={p.id} person={p} right={<Pill label="Stop sharing" danger disabled={busy} onPress={() => void run(() => revoke(p.id))} />} />
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
    </View>
  );
}

/** A list of people (followers or following): tap one to open the profile; the pill follows or unfollows. */
function PeopleList({ people, empty, onOpen }: { people: Person[]; empty: string; onOpen: (id: string) => void }) {
  const c = useColors();
  const { follow, unfollow } = useSocial();
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (p: Person) => {
    setBusy(p.id);
    try {
      await (p.relation.following ? unfollow(p.id) : follow(p.id));
    } finally {
      setBusy(null);
    }
  };
  if (people.length === 0) return <Text style={[type.body, { color: c.textMuted }]}>{empty}</Text>;
  return (
    <View style={{ gap: spacing.xs }}>
      {people.map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          subtitle={p.relation.mutual ? 'Mutual' : undefined}
          onPress={() => onOpen(p.id)}
          right={<Pill label={p.relation.following ? 'Following' : p.relation.followsMe ? 'Follow back' : 'Follow'} primary={!p.relation.following} disabled={busy === p.id} onPress={() => void toggle(p)} />}
        />
      ))}
    </View>
  );
}

function OwnProfile({ email, onOpen, onEditAccount }: { email: string; onOpen: (id: string) => void; onEditAccount: () => void }) {
  const c = useColors();
  const { profile, counts, following, followers, given } = useSocial();
  const { data } = useStore();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'followers' | 'following' | 'access' | null>(null);
  const summary = useMemo<Summary>(() => buildSummary(data), [data]);

  // first time: the form is the page itself; afterwards "Edit profile" opens it in a dialog
  if (!profile) {
    return (
      <Card style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.title, { color: c.text }]}>Create your profile</Text>
        <ProfileForm email={email} existing={null} onDone={() => {}} />
      </Card>
    );
  }
  const open = (h: string) => {
    setDialog(null);
    onOpen(h);
  };
  return (
    <View style={{ gap: spacing.lg }}>
      <Header
        name={profile.displayName}
        id={profile.id}
        color={profile.color}
        photo={profile.photo}
        followers={counts.followers}
        following={counts.following}
        access={given.length}
        onCount={setDialog}
        actions={
          <>
            <Pill label="Edit profile" icon="edit-2" onPress={() => setEditing(true)} />
            <Pill label="Edit account" icon="settings" onPress={onEditAccount} />
          </>
        }
      />
      <Card>
        <Text style={[type.title, { color: c.text }]}>Your summary</Text>
        <Text style={[type.body, { color: c.textMuted }]}>Only you see this, unless you share it. Tap "With access" above to choose who can.</Text>
        <SummaryView summary={summary} />
      </Card>

      <Sheet visible={editing} title="Edit profile" onClose={() => setEditing(false)}>
        <ProfileForm email={email} existing={profile} onDone={() => setEditing(false)} />
      </Sheet>
      <Sheet visible={dialog === 'followers'} title={`Followers · ${followers.length}`} onClose={() => setDialog(null)}>
        <PeopleList people={followers} empty="Nobody follows you yet." onOpen={open} />
      </Sheet>
      <Sheet visible={dialog === 'following'} title={`Following · ${following.length}`} onClose={() => setDialog(null)}>
        <PeopleList people={following} empty="You are not following anyone yet. Find people with the search at the top." onOpen={open} />
      </Sheet>
      <Sheet visible={dialog === 'access'} title="Who can see your summary" onClose={() => setDialog(null)}>
        <ShareContent />
      </Sheet>
    </View>
  );
}

function OtherProfile({ id }: { id: string }) {
  const c = useColors();
  const { follow, unfollow, openChat } = useSocial();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [summary, setSummary] = useState<{ summary: Summary | null; updatedAt: number | null } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { person: p } = await socialApi.person(id);
      setPerson(p);
      const shared = p.summaryAccess ? await socialApi.summaryOf(id).catch(() => null) : null;
      // an older snapshot (before it was made of percentages only) is not shown
      setSummary(shared && shared.summary?.version === 2 ? shared : shared ? { summary: null, updatedAt: null } : null);
    } catch {
      setMissing(true);
    }
  }, [id]);
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
      await (relation.following ? unfollow(id) : follow(id));
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
        id={person.id}
        color={person.color}
        photo={person.photo}
        followers={person.followers}
        following={person.following}
        actions={
          <>
            <Pill label={relation.following ? 'Following' : relation.followsMe ? 'Follow back' : 'Follow'} icon={relation.following ? 'check' : 'user-plus'} primary={!relation.following} disabled={busy} onPress={toggle} />
            {relation.mutual ? <Pill label="Message" icon="message-circle" onPress={() => openChat(id)} /> : null}
          </>
        }
      />
      {summary?.summary ? (
        <Card>
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
export function ProfilePage({ id, email, onBack, onOpen, onEditAccount }: { id: string | 'me'; email: string; onBack: () => void; onOpen: (id: string) => void; onEditAccount: () => void }) {
  const c = useColors();
  const { profile } = useSocial();
  const mine = id === 'me' || (!!profile && id === profile.id);
  return (
    <View style={s.page}>
      <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed, hovered }: any) => [s.back, { opacity: pressed ? 0.6 : 1, backgroundColor: hovered ? c.surface : 'transparent' }]}>
        <Feather name="arrow-left" size={20} color={c.textMuted} />
        <Text style={[type.label, { color: c.textMuted }]}>Back</Text>
      </Pressable>
      {mine ? <OwnProfile email={email} onOpen={onOpen} onEditAccount={onEditAccount} /> : <OtherProfile id={id} />}
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
});
