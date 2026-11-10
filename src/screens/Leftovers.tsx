import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Money } from '../components/Motion';
import { CoverGoal, MonthResult, coverLabel, coverTicks, dailyIntention, isRecordMonth } from '../domain/abundance';
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
  /** months of spending the pile covers and the goal (double) */
  cover: CoverGoal | null;
  /** the last months, newest first (index 0 = current), for records and the best streak */
  results: MonthResult[];
}

/** The first thing on the screen: the pile of leftovers, this month's gain, the streak and the next milestone. Mostly visual. */
export function LeftoversHero({ leftovers, monthLeft, streak, cover, results }: Props) {
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

      {cover && <CoverBar cover={cover} />}

      <View style={[s.intention, { backgroundColor: c.surface }]}>
        <Feather name="wind" size={20} color={c.primary} />
        <Text style={[type.body, { color: c.text, flexShrink: 1, fontStyle: 'italic' }]}>{dailyIntention(day)}</Text>
      </View>
    </Card>
  );
}

/**
 * What the pile covers (blue) and the next goal, with a bar between them and dotted lines for every stage. Reaching a goal
 * moves it up (1, 3, 6, 12, 18, 24 months, then years).
 */
function CoverBar({ cover }: { cover: CoverGoal }) {
  const covered = coverLabel(cover.months);
  const goal = coverLabel(cover.goal);
  const ticks = coverTicks(cover.goal);
  return (
    <View style={{ gap: spacing.sm }} accessible accessibilityLabel={`${covered} → ${goal}`}>
      {/* the values sit outside the bar: what is covered on the left (blue), the goal on the right */}
      <View style={s.values}>
        <Text style={[type.title, { color: c.primary }]} numberOfLines={1}>{covered}</Text>
        <Text style={[type.title, { color: c.text }]} numberOfLines={1}>{goal}</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${Math.min(cover.months / cover.goal, 1) * 100}%` }]} />
        {/* dotted lines: each stage reached (over the blue) and each one still to reach (over the gray) */}
        {ticks.map((f) => (
          <View key={f} style={[s.mark, { left: `${f * 100}%` as `${number}%` }]}>
            {[0, 1, 2].map((d) => <View key={d} style={[s.dot, { backgroundColor: f * cover.goal <= cover.months + 1e-9 ? 'rgba(255,255,255,0.9)' : 'rgba(15,27,51,0.35)' }]} />)}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  values: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  track: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: c.surfaceAlt },
  fill: { backgroundColor: c.primary },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, justifyContent: 'space-evenly', alignItems: 'center' },
  dot: { width: 2, height: 2, borderRadius: 1 },
  card: { gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, borderRadius: radius.pill },
  intention: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.control },
});
