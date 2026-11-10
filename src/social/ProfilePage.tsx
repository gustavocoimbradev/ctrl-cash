import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '../components/Card';
import { AnimatedBar } from '../components/Motion';
import { PillToggle } from '../components/Controls';
import { Sheet } from '../components/Sheet';
import { buildOwnChart, buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { desktopBreakpoint, maxContentWidth, radius, spacing, type, useColors } from '../theme';
import { Person, PersonDetail, SHARE_REQUEST, ShareMode, Summary, socialApi } from './api';
import { CodeInput, FoundPerson, useCodeLookup } from './code';
import { ProfileForm } from './ProfileForm';
import { useSocial } from './SocialProvider';
import { SummaryView } from './SummaryView';
import { fakeSummary } from './fakeSummary';
import { Avatar, Empty, Pill, PersonRow } from './parts';
import { t } from '../i18n';

const COUNT_PAD = 14;
/** A number under a label. With `onPress` it is a button (the lists behind the counters open in a dialog). */
const Count = ({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) => {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? t('{label}: {n}', { label, n }) : undefined}
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
      accessibilityLabel={t('Code {code}. Copy', { code: code.split('').join(' ') })}
      onPress={copy}
      style={({ pressed, hovered }: any) => [s.chip, { opacity: pressed ? 0.6 : hovered ? 1 : 0.8 }]}
    >
      <Text style={[type.body, { color: copied ? c.income : c.textMuted, letterSpacing: 2 }]}>{copied ? t('Copied') : code}</Text>
      {!copied ? <Feather name="copy" size={14} color={c.textMuted} /> : null}
    </Pressable>
  );
}

/**
 * Drawn but unreadable: what a person who has not shared would show, made of invented numbers (never theirs). It cannot be
 * reached by the keyboard or read by a screen reader, and on the web it is blurred.
 */
function Blurred({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(Platform.OS === 'web' ? ({ 'aria-hidden': true, inert: '' } as object) : {})}
      style={[Platform.OS === 'web' ? ({ filter: 'blur(9px)', userSelect: 'none' } as object) : { opacity: 0.35 }, style]}
    >
      {children}
    </View>
  );
}

/** The financial health score as the header shows it: the number big, and how good it is under it. */
type Score = NonNullable<Summary['health']>;
const scoreColors = (score: number, c: ReturnType<typeof useColors>) => (score < 250 ? c.expense : score < 500 ? c.warning : c.primary);
const scoreName = (l: Score['label']) => (l === 'Critical' ? t('Starting out') : l === 'Warning' ? t('Building') : l === 'Good' ? t('Growing') : t('Thriving'));

function ScoreBadge({ health, wide }: { health: Score; wide: boolean }) {
  const c = useColors();
  const color = scoreColors(health.score, c);
  const parts = [
    { label: t('Wealth'), v: health.wealth },
    { label: t('Debt-free'), v: health.debt },
    { label: t('Healthy spending'), v: health.habits },
    { label: t('Month result'), v: health.month },
  ];
  return (
    <View
      accessible
      accessibilityLabel={t('Financial health: {score}, {label}', { score: health.score, label: scoreName(health.label) })}
      style={[s.score, { flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? spacing.xl : spacing.md }, wide && { paddingLeft: spacing.xl, borderLeftWidth: 1, borderLeftColor: c.border }, !wide && { alignSelf: 'stretch' }]}
    >
      <View style={{ alignItems: 'center', gap: spacing.xs, minWidth: 150 }}>
        <Text style={[type.body, { color: c.textMuted }]}>{t('Financial health')}</Text>
        <Text style={[type.hero, { color, fontSize: wide ? 48 : 40, lineHeight: wide ? 54 : 46 }]}>{health.score}</Text>
        <View style={{ backgroundColor: `${color}1F`, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 2 }}>
          <Text style={[type.label, { color }]}>{scoreName(health.label)}</Text>
        </View>
      </View>
      {/* what the score is made of, each part filled from 0 to 100% */}
      <View style={{ gap: spacing.sm, width: wide ? 250 : '100%' }}>
        {parts.map((p) => (
          <View key={p.label} style={{ gap: 2 }}>
            <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{p.label}</Text>
            {/* the bar fills its width as a row child (it is built to sit in a row) */}
            <View style={{ flexDirection: 'row' }}>
              <AnimatedBar ratio={p.v / 100} color={p.v < 34 ? c.expense : p.v < 67 ? c.warning : c.primary} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Where the score will be, while the person's app has not published it yet (it does so the next time it is open). */
function PendingScore({ wide }: { wide: boolean }) {
  const c = useColors();
  // the same layout as the real score, with the number as "--" and the four bars empty
  const parts = [t('Wealth'), t('Debt-free'), t('Healthy spending'), t('Month result')];
  return (
    <View style={[s.score, { flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? spacing.xl : spacing.md }, wide && { paddingLeft: spacing.xl, borderLeftWidth: 1, borderLeftColor: c.border }, !wide && { alignSelf: 'stretch' }]}>
      <View style={{ alignItems: 'center', gap: spacing.xs, minWidth: 150, maxWidth: 200 }}>
        <Text style={[type.body, { color: c.textMuted }]}>{t('Financial health')}</Text>
        <Text style={[type.hero, { color: c.textMuted, fontSize: wide ? 48 : 40, lineHeight: wide ? 54 : 46 }]}>--</Text>
        <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>{t('Shows up as soon as their app publishes it.')}</Text>
      </View>
      <View style={{ gap: spacing.sm, width: wide ? 250 : '100%' }}>
        {parts.map((label) => (
          <View key={label} style={{ gap: 2 }}>
            <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{label}</Text>
            <View style={{ flexDirection: 'row' }}>
              <AnimatedBar ratio={0} color={c.primary} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The top card of a profile: who it is, the code, the numbers and, under them, the actions; the score sits on the right. */
function Header({ name, code, color, photo, counters, actions, health, scoreBlurred, scorePending }: { name: string; code: string; color: string | null; photo?: string | null; counters?: { n: number; label: string; onPress: () => void }[]; actions?: React.ReactNode; health?: Score; /** made-up score, drawn blurred (nothing shared yet) */ scoreBlurred?: boolean; /** shared, but their app has not published the score yet */ scorePending?: boolean }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= desktopBreakpoint;
  return (
    <Card style={[s.head, wide && s.headWide]}>
      <Avatar name={name} id={code} color={color} photo={photo} size={wide ? 104 : 88} />
      <View style={[s.headInfo, !wide && { alignItems: 'center', alignSelf: 'stretch' }]}>
        <View style={[s.nameRow, !wide && { justifyContent: 'center' }]}>
          <Text style={[type.hero, { color: c.text, fontSize: 28, flexShrink: 1 }, !wide && { textAlign: 'center' }]} numberOfLines={2}>{name}</Text>
          <CodeChip code={code} />
        </View>
        {counters?.length ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginLeft: wide ? -COUNT_PAD : 0, alignSelf: wide ? 'flex-start' : 'stretch', justifyContent: 'center' }}>
            {counters.map((x) => <Count key={x.label} n={x.n} label={x.label} onPress={x.onPress} />)}
          </View>
        ) : null}
        {!wide && !health && scorePending ? <PendingScore wide={false} /> : null}
        {!wide && health ? (scoreBlurred ? <Blurred><ScoreBadge health={health} wide={false} /></Blurred> : <ScoreBadge health={health} wide={false} />) : null}
        {actions ? <View style={[s.actions, !wide && { alignSelf: 'stretch' }]}>{actions}</View> : null}
      </View>
      {wide && !health && scorePending ? <PendingScore wide /> : null}
      {wide && health ? (scoreBlurred ? <Blurred><ScoreBadge health={health} wide /></Blurred> : <ScoreBadge health={health} wide />) : null}
    </Card>
  );
}

/** Who gets my summary: the list (each one can be stopped) and a field to add somebody by their code. Many people can be added. */
function ShareDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { given, share, revoke } = useSocial();
  const finder = useCodeLookup();
  const [busy, setBusy] = useState<string | null>(null);
  /** what a new share shows: percentages and the score, or the real values too */
  const [mode, setMode] = useState<ShareMode>('percent');
  useEffect(() => {
    if (!visible) {
      finder.clear();
      setMode('percent');
    }
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
  const modes = [
    { value: 'percent' as ShareMode, label: t('Percentages') },
    { value: 'amounts' as ShareMode, label: t('Amounts') },
  ];
  return (
    <Sheet visible={visible} title={t('Share your data')} onClose={onClose}>
      <Text style={[type.body, { color: c.textMuted }]}>
        {t('Type the code of the person you want to share your summary with, and choose what they see. Never single transactions, and you can stop at any time.')}
      </Text>
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.label, { color: c.text }]}>{t('What they see')}</Text>
        <PillToggle<ShareMode> stretch value={mode} onChange={setMode} options={modes} />
        <Text style={[type.body, { color: c.textMuted }]}>{mode === 'percent' ? t('Percentages and your score: no amounts.') : t('The real amounts too: what you receive, spend and owe by category.')}</Text>
      </View>
      <CodeInput value={finder.text} onChange={finder.setText} placeholder={t('Their code')} />
      <FoundPerson
        lookup={finder.lookup}
        actions={(p) =>
          p.sharedWithThem ? (
            <Text style={[type.body, { color: c.textMuted }]}>{t('You already share your data with {name}.', { name: p.displayName })}</Text>
          ) : (
            <Pill label={t('Share my data')} icon="share-2" primary disabled={busy === p.code} onPress={() => void run(p.code, async () => { await share(p.code, mode); finder.clear(); })} />
          )
        }
      />
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.label, { color: c.text }]}>{t('Sharing with · {n}', { n: given.length })}</Text>
        {given.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('Nobody yet.')}</Text> : null}
        {given.map((p) => (
          <PersonRow
            key={p.code}
            person={p}
            subtitle={p.mode === 'amounts' ? t('Sees amounts') : t('Sees percentages')}
            right={
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Pill label={p.mode === 'amounts' ? t('Show percentages') : t('Show amounts')} disabled={busy === p.code} onPress={() => void run(p.code, () => share(p.code, p.mode === 'amounts' ? 'percent' : 'amounts'))} />
                <Pill label={t('Stop sharing')} danger disabled={busy === p.code} onPress={() => void run(p.code, () => revoke(p.code))} />
              </View>
            }
          />
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
  /** only on my own profile: the line chart with real money */
  const ownChart = useMemo(() => buildOwnChart(data), [data]);

  // the profile is made automatically; this only shows while it is on its way (or if it could not be made)
  if (!profile) {
    return (
      <Card style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.title, { color: c.text }]}>{t('Create your profile')}</Text>
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
        health={summary.health}
        counters={[
          { n: given.length, label: t('Sharing with'), onPress: () => setDialog('share') },
          { n: received.length, label: t('Shared with me'), onPress: () => setDialog('received') },
        ]}
        actions={
          <>
            <Pill label={t('Share data')} icon="share-2" primary block={narrow} onPress={() => setDialog('share')} />
            <Pill label={t('Edit profile')} icon="edit-2" grow={narrow} onPress={() => setEditing(true)} />
            <Pill label={t('Edit account')} icon="settings" grow={narrow} onPress={onEditAccount} />
          </>
        }
      />
      <Card>
        <Text style={[type.title, { color: c.text }]}>{t('Your summary')}</Text>
        <SummaryView summary={summary} real={ownChart} />
      </Card>

      <Sheet visible={editing} title={t('Edit profile')} onClose={() => setEditing(false)}>
        <ProfileForm email={email} existing={profile} onDone={() => setEditing(false)} />
      </Sheet>
      <ShareDialog visible={dialog === 'share'} onClose={() => setDialog(null)} />
      <Sheet visible={dialog === 'received'} title={t('Shared with me · {n}', { n: received.length })} onClose={() => setDialog(null)}>
        {received.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('Nobody shares their data with you yet. Give them your code ({code}) so they can.', { code: profile.code })}</Text> : null}
        <View style={{ gap: spacing.xs }}>
          {received.map((p: Person) => (
            <PersonRow key={p.code} person={p} subtitle={t('Tap to see their summary')} onPress={() => { setDialog(null); onOpen(p.code); }} />
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
  const [summary, setSummary] = useState<{ summary: Summary | null; updatedAt: number | null; amounts?: Awaited<ReturnType<typeof socialApi.summaryOf>>['amounts'] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  /** the request to share their data was sent from this page */
  const [requested, setRequested] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

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
    // what they publish shows up here by itself while the page is open
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (missing) return <Card><Empty icon="user-x" text={t('Nobody has this code.')} /></Card>;
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
        // shared: their real score (or, until their app publishes it, a plain "--"); not shared: invented numbers, blurred
        health={person.summaryAccess ? summary?.summary?.health : fakeSummary().health}
        scoreBlurred={!person.summaryAccess}
        scorePending={person.summaryAccess && !summary?.summary?.health}
        actions={
          <>
            <Pill label={t('Message')} icon="heart" primary grow={narrow} onPress={() => openChat(code)} />
            <Pill label={person.sharedWithThem ? t('Stop sharing') : t('Share my data')} icon="share-2" danger={person.sharedWithThem} grow={narrow} disabled={busy} onPress={toggle} />
          </>
        }
      />
      {summary?.summary ? (
        <Card>
          <Text style={[type.title, { color: c.text }]}>{t("{name}'s summary", { name: first })}</Text>
          <SummaryView summary={summary.summary} updatedAt={summary.updatedAt} real={summary.amounts ?? undefined} realCurrency={summary.amounts?.currency} />
        </Card>
      ) : (
        // nothing real to show: the page is drawn whole with invented numbers, blurred, with the way to ask for the real ones on top
        <Card style={{ overflow: 'hidden' }}>
          <Text style={[type.title, { color: c.text }]}>{t("{name}'s summary", { name: first })}</Text>
          <Blurred>
            <SummaryView summary={fakeSummary()} />
          </Blurred>
          <View style={s.veil}>
            <View style={[s.veilCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="lock" size={24} color={c.textMuted} />
              <Text style={[type.body, { color: c.text, textAlign: 'center' }]}>
                {person.summaryAccess ? t('{name} shared the summary, but it has not been published yet.', { name: first }) : t('{name} has not shared a summary with you.', { name: first })}
              </Text>
              {!person.summaryAccess ? (
                requested === 'sent' ? (
                  <Text style={[type.body, { color: c.income, textAlign: 'center' }]}>{t('Request sent. {name} will see a button to share.', { name: first })}</Text>
                ) : (
                  <Pill
                    label={t('Request data sharing')}
                    icon="send"
                    primary
                    disabled={requested === 'sending'}
                    onPress={async () => {
                      setRequested('sending');
                      try {
                        await socialApi.send(code, SHARE_REQUEST);
                        setRequested('sent');
                      } catch {
                        setRequested('failed');
                      }
                    }}
                  />
                )
              ) : null}
              {requested === 'failed' ? <Text style={[type.body, { color: c.expense, textAlign: 'center' }]}>{t('The request was not sent. Try again.')}</Text> : null}
            </View>
          </View>
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
  score: { minWidth: 150 },
  /** over the blurred page: the message and the button, in the middle */
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  veilCard: { maxWidth: 380, borderRadius: radius.card, borderWidth: 1, padding: spacing.xl, gap: spacing.md, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, ...(Platform.OS === 'web' ? ({ boxShadow: '0 12px 40px rgba(15,27,51,0.35)' } as object) : null) },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
