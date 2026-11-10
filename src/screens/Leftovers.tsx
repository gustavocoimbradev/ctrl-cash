import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Money } from '../components/Motion';
import { motion, useTween } from '../theme/motion';
import { MilestoneProgress, MonthResult, WealthScale, dailyIntention, isRecordMonth, milestoneName, scaleEnd, scaleTick } from '../domain/abundance';
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
  /** the milestones (only to celebrate a new one) */
  milestones: MilestoneProgress | null;
  /** the ruler under the pile */
  scale: WealthScale | null;
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
export function LeftoversHero({ leftovers, monthLeft, streak, milestones, scale, results }: Props) {
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
      </View>

      {(gain || streak.months > 0 || record) && (
        <View style={s.chips}>
          {gain && (
            <View style={[s.gain, { backgroundColor: 'rgba(31,168,106,0.12)' }]}>
              <Feather name="trending-up" size={20} color={c.income} />
              <Text style={[type.label, { color: c.income }]}>{t('+{amount} this month', { amount: formatMoney(monthLeft) })}</Text>
            </View>
          )}
          {record && (
            <View style={[s.gain, { backgroundColor: 'rgba(45,85,217,0.1)' }]}>
              <Feather name="award" size={20} color={c.primary} />
              <Text style={[type.label, { color: c.primary }]}>{t('Record month')}</Text>
            </View>
          )}
          {streak.months > 0 && (
            <View style={[s.gain, { backgroundColor: 'rgba(217,131,31,0.12)' }]}>
              <Feather name="zap" size={20} color={c.warning} />
              <Text style={[type.label, { color: c.warning }]}>{t('Month {n} in a row saving', { n: streak.months })}</Text>
            </View>
          )}
        </View>
      )}

      {scale && <Ruler scale={scale} />}

      <View style={[s.intention, { backgroundColor: c.surface }]}>
        <Feather name="wind" size={20} color={c.primary} />
        <Text style={[type.body, { color: c.text, flexShrink: 1, fontStyle: 'italic' }]}>{dailyIntention(day)}</Text>
      </View>
    </Card>
  );
}

/** One bar split by dotted lines (a month each at first); its end moves up as the pile grows. Numbers only, the unit is the title. */
function Ruler({ scale }: { scale: WealthScale }) {
  const fill = useTween(scale.ratio * 100, motion.slow);
  const parts = Array.from({ length: scale.count }, (_, i) => i);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.body, { color: c.textMuted }]}>{scale.unit === 'months' ? t('Months of spending covered by your wealth') : t('Years of spending covered by your wealth')}</Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${fill}%` }]} />
        <View style={s.lines}>
          {parts.map((i) => (
            <View key={i} style={s.part}>
              {i < scale.count - 1 && (
                <View style={s.dots}>
                  {[0, 1, 2, 3].map((d) => <View key={d} style={s.dot} />)}
                </View>
              )}
            </View>
          ))}
        </View>
      </View>
      <View style={s.labels}>
        {parts.map((i) => (
          <Text key={i} style={[type.label, { color: c.textMuted, flex: 1, textAlign: 'right' }]}>{scaleTick(scale, i + 1)}</Text>
        ))}
      </View>
      <Text style={[type.body, { color: c.textMuted }]}>{t('{amount} to reach {time}', { amount: formatMoney(scale.missing), time: scaleEnd(scale) })}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  track: { height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: c.surfaceAlt },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.primary },
  lines: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  part: { flex: 1, alignItems: 'flex-end' },
  dots: { position: 'absolute', right: -1, top: 0, bottom: 0, justifyContent: 'space-evenly' },
  dot: { width: 2, height: 2, borderRadius: 1, backgroundColor: c.card },
  labels: { flexDirection: 'row' },
  card: { gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, borderRadius: radius.pill },
  party: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 44, borderRadius: radius.control },
  intention: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.control },
});
