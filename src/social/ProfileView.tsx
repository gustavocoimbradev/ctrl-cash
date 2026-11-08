import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Select } from '../components/Select';
import { buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { spacing, type, useColors } from '../theme';
import { PersonDetail, Summary, socialApi } from './api';
import { useSocial } from './SocialProvider';
import { SummaryView } from './SummaryView';
import { Avatar, Empty, Pill, PersonRow } from './parts';

const Count = ({ n, label }: { n: number; label: string }) => {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', minWidth: 80 }}>
      <Text style={[type.title, { color: c.text }]}>{n}</Text>
      <Text style={[type.body, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
};

/** Lets the owner choose who can read the summary: only people who follow each other, and every grant can be taken back. */
function ShareManager() {
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
    <View style={{ gap: spacing.md }}>
      <Text style={[type.title, { color: c.text }]}>Share summary</Text>
      <Text style={[type.body, { color: c.textMuted }]}>
        Only people you follow and who follow you back can be given access. They see the summary above (never single transactions) when they open your profile. You can stop sharing at any time.
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
        <Text style={[type.body, { color: c.textMuted }]}>
          {mutual.length === 0 ? 'Follow people who follow you back to be able to share with them.' : 'You are already sharing with everyone who follows you back.'}
        </Text>
      )}
    </View>
  );
}

/** My own profile: the summary (only I can see it) and the sharing controls. */
function OwnProfile({ onEdit }: { onEdit: () => void }) {
  const c = useColors();
  const { profile, counts } = useSocial();
  const { data } = useStore();
  const summary = useMemo<Summary>(() => buildSummary(data), [data]);
  if (!profile) return null;
  return (
    <View style={{ gap: spacing.xl }}>
      <Header name={profile.displayName} handle={profile.handle} color={profile.color} bio={profile.bio} followers={counts.followers} following={counts.following} action={<Pill label="Edit profile" icon="edit-2" onPress={onEdit} />} />
      <View style={{ gap: spacing.md }}>
        <Text style={[type.title, { color: c.text }]}>Your summary</Text>
        <Text style={[type.body, { color: c.textMuted }]}>Only you see this, unless you share it below.</Text>
        <SummaryView summary={summary} />
      </View>
      <ShareManager />
    </View>
  );
}

function Header({ name, handle, color, bio, followers, following, action }: { name: string; handle: string; color: string | null; bio: string | null; followers: number; following: number; action?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', gap: spacing.md }}>
      <Avatar name={name} handle={handle} color={color} size={88} />
      <View style={{ alignItems: 'center' }}>
        <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>{name}</Text>
        <Text style={[type.body, { color: c.textMuted }]}>@{handle}</Text>
      </View>
      {bio ? <Text style={[type.body, { color: c.text, textAlign: 'center' }]}>{bio}</Text> : null}
      <View style={{ flexDirection: 'row', gap: spacing.xl }}>
        <Count n={followers} label="Followers" />
        <Count n={following} label="Following" />
      </View>
      {action}
    </View>
  );
}

/** Somebody else's profile: follow, message and, when they shared it with me, their summary. */
function OtherProfile({ handle, onMessage }: { handle: string; onMessage: (h: string) => void }) {
  const c = useColors();
  const { follow, unfollow } = useSocial();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [summary, setSummary] = useState<{ summary: Summary | null; updatedAt: number | null } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { person: p } = await socialApi.person(handle);
      setPerson(p);
      if (p.summaryAccess) setSummary(await socialApi.summaryOf(handle).catch(() => null));
      else setSummary(null);
    } catch {
      setMissing(true);
    }
  }, [handle]);
  useEffect(() => {
    setPerson(null);
    setMissing(false);
    void load();
  }, [load]);

  if (missing) return <Empty icon="user-x" text="This person could not be found." />;
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

  return (
    <View style={{ gap: spacing.xl }}>
      <Header
        name={person.displayName}
        handle={person.handle}
        color={person.color}
        bio={person.bio}
        followers={person.followers}
        following={person.following}
        action={
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Pill label={relation.following ? 'Following' : relation.followsMe ? 'Follow back' : 'Follow'} icon={relation.following ? 'check' : 'user-plus'} primary={!relation.following} disabled={busy} onPress={toggle} />
            {relation.mutual ? <Pill label="Message" icon="message-circle" onPress={() => onMessage(handle)} /> : null}
          </View>
        }
      />
      {relation.followsMe && !relation.following ? <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>Follows you.</Text> : null}
      {!relation.mutual ? <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>Follow each other to chat and to share summaries.</Text> : null}
      {summary?.summary ? (
        <View style={{ gap: spacing.md }}>
          <Text style={[type.title, { color: c.text }]}>{person.displayName.split(' ')[0]}'s summary</Text>
          <SummaryView summary={summary.summary} updatedAt={summary.updatedAt} />
        </View>
      ) : person.summaryAccess ? (
        <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>They shared their summary, but it has not been published yet.</Text>
      ) : relation.mutual ? (
        <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>They have not shared their summary with you.</Text>
      ) : null}
    </View>
  );
}

export function ProfileView({ handle, onEdit, onMessage }: { handle: string | 'me'; onEdit: () => void; onMessage: (h: string) => void }) {
  return handle === 'me' ? <OwnProfile onEdit={onEdit} /> : <OtherProfile handle={handle} onMessage={onMessage} />;
}
