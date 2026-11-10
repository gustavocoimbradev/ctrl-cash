import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Money } from '../components/Motion';
import { motion, useTween } from '../theme/motion';
import { LevelProgress, MonthResult, dailyIntention, isRecordMonth, levelLabel } from '../domain/abundance';
import { formatMoney } from '../domain/money';
import { formatRunway } from '../domain/wealth';
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
  /** where the pile stands between two levels of months of spending covered */
  level: LevelProgress | null;
  /** the last months, newest first (index 0 = current), for records and the best streak */
  results: MonthResult[];
}

/** The first thing on the screen: the pile of leftovers, this month's gain, the streak and the next milestone. Mostly visual. */
export function LeftoversHero({ leftovers, monthLeft, streak, level, results }: Props) {
  const gain = monthLeft > 0;
  const record = isRecordMonth(results);
  const day = Math.floor(Date.now() / 86400000);
  return (
    <Card style={s.card}>
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

      {level && <LevelBar level={level} />}

      <View style={[s.intention, { backgroundColor: c.surface }]}>
        <Feather name="wind" size={20} color={c.primary} />
        <Text style={[type.body, { color: c.text, flexShrink: 1, fontStyle: 'italic' }]}>{dailyIntention(day)}</Text>
      </View>
    </Card>
  );
}

/**
 * The progress to the next level: what the pile covers now (left), the next goal (right) and a bar between the last level
 * reached and that goal, with the percentage inside. The goal is always close, and moves up when it is reached.
 */
function LevelBar({ level }: { level: LevelProgress }) {
  const fill = useTween(level.ratio * 100, motion.slow);
  const pct = Math.round(level.ratio * 100);
  return (
    <View style={{ gap: spacing.sm }} accessible accessibilityLabel={`${formatRunway(level.months)} → ${levelLabel(level.to)}, ${pct}%`}>
      <View style={s.ends}>
        <Text style={[type.title, { color: c.primary }]}>{formatRunway(level.months)}</Text>
        <Text style={[type.title, { color: c.text }]}>{levelLabel(level.to)}</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${Math.max(fill, 6)}%` }]}>
          {pct >= 15 && <Text style={[type.label, { color: c.onPrimary }]}>{pct}%</Text>}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  track: { height: 28, borderRadius: 14, overflow: 'hidden', backgroundColor: c.surfaceAlt },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.primary, borderRadius: 14, alignItems: 'flex-end', justifyContent: 'center', paddingRight: spacing.md },
  ends: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  card: { gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, borderRadius: radius.pill },
  intention: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.control },
});
