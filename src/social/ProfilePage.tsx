import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { desktopBreakpoint, maxContentWidth, spacing, type, useColors } from '../theme';
import { Person, PersonDetail, Summary, socialApi } from './api';
import { CodeInput, FoundPerson, useCodeLookup } from './code';
import { ProfileForm } from './ProfileForm';
import { useSocial } from './SocialProvider';
import { SummaryView } from './SummaryView';
import { Avatar, Empty, Pill, PersonRow } from './parts';

const COUNT_PAD = 14;
/** A number under a label. With `onPress` it is a button (the lists behind the counters open in a dialog). */
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

/** The person's code, quiet and right after the name; tapping it copies it. */
function CodeChip({ code }: { code: string }) {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no clipboard: the code is on screen anyway
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Code ${code.split('').join(' ')}. Copy`}
      onPress={copy}
      style={({ pressed, hovered }: any) => [s.chip, { opacity: pressed ? 0.6 : hovered ? 1 : 0.8 }]}
    >
      <Text style={[type.body, { color: copied ? c.income : c.textMuted, letterSpacing: 2 }]}>{copied ? 'Copied' : code}</Text>
      {!copied ? <Feather name="copy" size={14} color={c.textMuted} /> : null}
    </Pressable>
  );
}

/** The top card of a profile: who it is, the code, the numbers and the actions. */
function Header({ name, code, color, photo, counters, actions }: { name: string; code: string; color: string | null; photo?: string | null; counters?: { n: number; label: string; onPress: () => void }[]; actions?: React.ReactNode }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;
  return (
    <Card style={[s.head, wide && s.headWide]}>
      <Avatar name={name} id={code} color={color} photo={photo} size={wide ? 104 : 88} />
      <View style={[s.headInfo, !wide && { alignItems: 'center' }]}>
        <View style={[s.nameRow, !wide && { justifyContent: 'center' }]}>
          <Text style={[type.hero, { color: c.text, fontSize: 28, flexShrink: 1 }, !wide && { textAlign: 'center' }]} numberOfLines={2}>{name}</Text>
          <CodeChip code={code} />
        </View>
        {counters?.length ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginLeft: wide ? -COUNT_PAD : 0, alignSelf: wide ? 'flex-start' : 'stretch', justifyContent: 'center' }}>
            {counters.map((x) => <Count key={x.label} n={x.n} label={x.label} onPress={x.onPress} />)}
          </View>
        ) : null}
      </View>
      {actions ? <View style={[s.actions, !wide && { alignSelf: 'stretch' }]}>{actions}</View> : null}
    </Card>
  );
}

/** Who gets my summary: the list (each one can be stopped) and a field to add somebody by their code. Many people can be added. */
function ShareDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { given, share, revoke } = useSocial();
  const finder = useCodeLookup();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) finder.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const run = async (code: string, fn: () => Promise<void>) => {
    setBusy(code);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet visible={visible} title="Share your data" onClose={onClose}>
      <Text style={[type.body, { color: c.textMuted }]}>
        Type the code of the person you want to share your summary with. They see percentages only (never single transactions), and you can stop at any time.
      </Text>
      <CodeInput value={finder.text} onChange={finder.setText} placeholder="Their code" />
      <FoundPerson
        lookup={finder.lookup}
        actions={(p) =>
          p.sharedWithThem ? (
            <Text style={[type.body, { color: c.textMuted }]}>You already share your data with {p.displayName}.</Text>
          ) : (
            <Pill label="Share my data" icon="share-2" primary disabled={busy === p.code} onPress={() => void run(p.code, async () => { await share(p.code); finder.clear(); })} />
          )
        }
      />
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.label, { color: c.text }]}>Sharing with · {given.length}</Text>
        {given.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>Nobody yet.</Text> : null}
        {given.map((p) => (
          <PersonRow key={p.code} person={p} right={<Pill label="Stop sharing" danger disabled={busy === p.code} onPress={() => void run(p.code, () => revoke(p.code))} />} />
        ))}
      </View>
    </Sheet>
  );
}

/** My own profile: the summary (only I can see it) and who I share it with, or who shares theirs with me. */
function OwnProfile({ onOpen, onEditAccount, email }: { onOpen: (code: string) => void; onEditAccount: () => void; email: string }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const narrow = width < desktopBreakpoint;
  const { profile, given, received } = useSocial();
  const { data } = useStore();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'received' | null>(null);
  const summary = useMemo<Summary>(() => buildSummary(data), [data]);

  // the profile is made automatically; this only shows while it is on its way (or if it could not be made)
  if (!profile) {
    return (
      <Card style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.title, { color: c.text }]}>Create your profile</Text>
        <ProfileForm email={email} existing={null} onDone={() => {}} />
      </Card>
    );
  }
  return (
    <View style={{ gap: spacing.lg }}>
      <Header
        name={profile.displayName}
        code={profile.code}
        color={profile.color}
        photo={profile.photo}
        counters={[
          { n: given.length, label: 'Sharing with', onPress: () => setDialog('share') },
          { n: received.length, label: 'Shared with me', onPress: () => setDialog('received') },
        ]}
        actions={
          <>
            <Pill label="Share data" icon="share-2" primary block={narrow} onPress={() => setDialog('share')} />
            <Pill label="Edit profile" icon="edit-2" grow={narrow} onPress={() => setEditing(true)} />
            <Pill label="Edit account" icon="settings" grow={narrow} onPress={onEditAccount} />
          </>
        }
      />
      <Card>
        <Text style={[type.title, { color: c.text }]}>Your summary</Text>
        <SummaryView summary={summary} />
      </Card>

      <Sheet visible={editing} title="Edit profile" onClose={() => setEditing(false)}>
        <ProfileForm email={email} existing={profile} onDone={() => setEditing(false)} />
      </Sheet>
      <ShareDialog visible={dialog === 'share'} onClose={() => setDialog(null)} />
      <Sheet visible={dialog === 'received'} title={`Shared with me · ${received.length}`} onClose={() => setDialog(null)}>
        {received.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>Nobody shares their data with you yet. Give them your code ({profile.code}) so they can.</Text> : null}
        <View style={{ gap: spacing.xs }}>
          {received.map((p: Person) => (
            <PersonRow key={p.code} person={p} subtitle="Tap to see their summary" onPress={() => { setDialog(null); onOpen(p.code); }} />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

/** Somebody else's profile: message them, share mine with them and, when they shared theirs, their summary. */
function OtherProfile({ code }: { code: string }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const narrow = width < desktopBreakpoint;
  const { share, revoke, openChat } = useSocial();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [summary, setSummary] = useState<{ summary: Summary | null; updatedAt: number | null } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { person: p } = await socialApi.person(code);
      setPerson(p);
      const shared = p.summaryAccess ? await socialApi.summaryOf(code).catch(() => null) : null;
      // an older snapshot (before it was made of percentages only) is not shown
      setSummary(shared && shared.summary?.version === 2 ? shared : shared ? { summary: null, updatedAt: null } : null);
    } catch {
      setMissing(true);
    }
  }, [code]);
  useEffect(() => {
    setPerson(null);
    setMissing(false);
    void load();
  }, [load]);

  if (missing) return <Card><Empty icon="user-x" text="Nobody has this code." /></Card>;
  if (!person) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      await (person.sharedWithThem ? revoke(code) : share(code));
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
        code={person.code}
        color={person.color}
        photo={person.photo}
        actions={
          <>
            <Pill label="Message" icon="heart" primary grow={narrow} onPress={() => openChat(code)} />
            <Pill label={person.sharedWithThem ? 'Stop sharing' : 'Share my data'} icon="share-2" danger={person.sharedWithThem} grow={narrow} disabled={busy} onPress={toggle} />
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
            {person.summaryAccess ? `${first} shared the summary, but it has not been published yet.` : `${first} has not shared a summary with you.`}
          </Text>
        </Card>
      )}
    </View>
  );
}

/** A profile, as a page of its own: yours (summary, sharing) or somebody else's, by code. */
export function ProfilePage({ id, email, onOpen, onEditAccount }: { id: string | 'me'; email: string; onOpen: (code: string) => void; onEditAccount: () => void }) {
  const { profile } = useSocial();
  const mine = id === 'me' || (!!profile && id === profile.code);
  return (
    <View style={s.page}>
      {mine ? <OwnProfile email={email} onOpen={onOpen} onEditAccount={onEditAccount} /> : <OtherProfile code={id} />}
    </View>
  );
}

const s = StyleSheet.create({
  page: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', gap: spacing.md },
  head: { gap: spacing.lg, alignItems: 'center' },
  headWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, padding: spacing.xl },
  headInfo: { flex: 1, minWidth: 0, gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: spacing.md },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
