import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { AnimatedBar, Money } from '../components/Motion';
import { MILESTONES, MilestoneProgress, MonthResult, dailyIntention, isRecordMonth, milestoneName } from '../domain/abundance';
import { formatMoney } from '../domain/money';
import { colors as c, radius, spacing, type } from '../theme';
import { t } from '../i18n';

interface Props {
  /** what is left over and kept in the account right now, cents */
  leftovers: number;
  /** income minus expenses of the current month, cents */
  monthLeft: number;
  monthIncome: number;
  /** months in a row with something left over, and whether the current month has not got there yet */
  streak: { months: number; open: boolean };
  milestones: MilestoneProgress | null;
  /** the last months, newest first (index 0 = current), for records and the best streak */
  results: MonthResult[];
}

const SEEN_KEY = 'ctrlcash:milestones-seen';

/**
 * How many milestones the person has already been congratulated for. The first visit just records where they stand (no
 * party for what was reached long ago); a new one afterwards is celebrated once. Remembered on web; elsewhere once per run.
 */
function useCelebration(reached: number): { celebrate: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    let stored: number | null = null;
    try {
      if (Platform.OS === 'web') {
        const raw = window.localStorage.getItem(SEEN_KEY);
        stored = raw === null ? null : Number(raw);
      }
    } catch {
      stored = null;
    }
    if (stored === null || Number.isNaN(stored)) {
      stored = reached;
      save(reached);
    }
    setSeen(stored);
    // only on the first render of the screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = (n: number) => {
    try {
      if (Platform.OS === 'web') window.localStorage.setItem(SEEN_KEY, String(n));
    } catch {
      // nothing is remembered
    }
  };
  return {
    celebrate: seen !== null && reached > seen,
    dismiss: () => {
      setSeen(reached);
      save(reached);
    },
  };
}

/** The first thing on the screen: the pile of leftovers, this month's gain, the streak and the next milestone. Mostly visual. */
export function LeftoversHero({ leftovers, monthLeft, streak, milestones, results }: Props) {
  const gain = monthLeft > 0;
  const record = isRecordMonth(results);
  const party = useCelebration(milestones?.reached.length ?? 0);
  const lastReached = milestones?.reached[milestones.reached.length - 1];
  const day = Math.floor(Date.now() / 86400000);
  return (
    <Card style={s.card}>
      {party.celebrate && lastReached && (
        <Pressable accessibilityRole="button" accessibilityLabel={t('Dismiss')} onPress={party.dismiss} style={[s.party, { backgroundColor: c.primary }]}>
          <Feather name={lastReached.icon} size={24} color={c.onPrimary} />
          <Text style={[type.label, { color: c.onPrimary, flex: 1 }]}>{milestoneName(lastReached)}</Text>
          <Feather name="x" size={20} color={c.onPrimary} />
        </Pressable>
      )}
      <View style={s.top}>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{t('Accumulated wealth')}</Text>
          <Money cents={leftovers} style={[type.hero, { color: leftovers < 0 ? c.text : c.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} />
        </View>
        {record && (
          <View style={[s.chip, { backgroundColor: 'rgba(45,85,217,0.1)' }]} accessible accessibilityLabel={t('Record month')}>
            <Feather name="award" size={20} color={c.primary} />
          </View>
        )}
        {streak.months > 0 && (
          <View style={[s.chip, { backgroundColor: 'rgba(217,131,31,0.12)' }]} accessible accessibilityLabel={streak.months === 1 ? t('{n} month in a row growing your wealth', { n: 1 }) : t('{n} months in a row growing your wealth', { n: streak.months })}>
            <Feather name="zap" size={20} color={c.warning} />
            <Text style={[type.label, { color: c.warning }]}>{t('{n} mo.', { n: streak.months })}</Text>
          </View>
        )}
      </View>

      {gain && (
        <View style={[s.gain, { backgroundColor: 'rgba(31,168,106,0.12)' }]}>
          <Feather name="trending-up" size={20} color={c.income} />
          <Text style={[type.label, { color: c.income }]}>{t('+{amount} this month', { amount: formatMoney(monthLeft) })}</Text>
        </View>
      )}

      {milestones && (
        <View style={{ gap: spacing.sm }}>
          <View style={s.badges}>
            {MILESTONES.map((m) => {
              const done = milestones.reached.some((r) => r.id === m.id);
              return (
                <View key={m.id} style={[s.badge, { backgroundColor: done ? c.primary : c.surface }]} accessible accessibilityLabel={milestoneName(m)}>
                  <Feather name={m.icon} size={20} color={done ? c.onPrimary : c.textMuted} style={{ opacity: done ? 1 : 0.6 }} />
                </View>
              );
            })}
          </View>
          {milestones.next && (
            <View style={s.progress}>
              <AnimatedBar ratio={milestones.ratio} color={c.primary} height={10} />
              <Feather name={milestones.next.icon} size={20} color={c.primary} />
              <Text style={[type.label, { color: c.text }]}>{formatMoney(milestones.missing)}</Text>
            </View>
          )}
        </View>
      )}

      <View style={[s.intention, { backgroundColor: c.surface }]}>
        <Feather name="wind" size={20} color={c.primary} />
        <Text style={[type.body, { color: c.text, flexShrink: 1, fontStyle: 'italic' }]}>{dailyIntention(day)}</Text>
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, minWidth: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, justifyContent: 'center' },
  gain: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, borderRadius: radius.pill },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  party: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 44, borderRadius: radius.control },
  intention: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.control },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
