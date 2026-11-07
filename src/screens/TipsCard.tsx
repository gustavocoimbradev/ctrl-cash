import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { HelpTip } from '../components/HelpTip';
import { Sheet } from '../components/Sheet';
import { Impact, ScoreFactor } from '../domain/insights';
import { colors as c, radius, spacing, type } from '../theme';

const TONE = {
  negative: { color: c.expense, tint: 'rgba(224,68,107,0.12)' },
  positive: { color: c.income, tint: 'rgba(31,168,106,0.12)' },
} as const;

const IMPACT: Record<Impact, string> = { high: 'High impact', medium: 'Medium impact', low: 'Low impact' };

/** The two groups (pulling the score down / pushing it up), each factor with its impact. */
function FactorGroups({ factors }: { factors: ScoreFactor[] }) {
  const groups = [
    { key: 'negative' as const, label: 'Pulling your score down', list: factors.filter((x) => x.tone === 'negative') },
    { key: 'positive' as const, label: 'Pushing your score up', list: factors.filter((x) => x.tone === 'positive') },
  ].filter((g) => g.list.length > 0);
  return (
    <>
      {groups.map((g) => (
        <View key={g.key} style={{ gap: spacing.md }}>
          <Text style={[type.body, { color: c.textMuted, fontWeight: '600', letterSpacing: 0.3 }]}>{g.label}</Text>
          {g.list.map((x) => {
            const tone = TONE[x.tone];
            return (
              <View key={x.id} style={s.item}>
                <View style={[s.itemTile, { backgroundColor: tone.tint }]}>
                  <Feather name={x.icon as keyof typeof Feather.glyphMap} size={18} color={tone.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[type.label, { color: c.text }]}>{x.title}</Text>
                  <Text style={[type.body, { color: c.textMuted }]}>{x.text}</Text>
                  <View style={[s.impact, { backgroundColor: tone.tint }]}>
                    <Text style={[type.body, { color: tone.color, fontWeight: '600' }]}>{IMPACT[x.impact]}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}

const HELP = 'What is pushing your financial health score up or down right now, and how much each factor weighs.';

/**
 * "Score factors": plain statements about what pulls the financial health score down
 * and what pushes it up, each with its impact (see `buildScoreFactors`).
 * `scroll`: the list scrolls inside the card when the available height is short (desktop side column).
 * `collapsed` (phone): one quiet line with the counts that opens the full list in a dialog.
 */
export function ScoreFactorsCard({ factors, scroll, collapsed }: { factors: ScoreFactor[]; scroll?: boolean; collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  if (factors.length === 0) return null;

  if (collapsed) {
    const down = factors.filter((x) => x.tone === 'negative').length;
    const up = factors.length - down;
    return (
      <>
        <Card>
          <Pressable accessibilityRole="button" accessibilityLabel="Open the score factors" onPress={() => setOpen(true)} style={({ pressed }) => [s.head, { opacity: pressed ? 0.7 : 1 }]}>
            <View style={[s.tile, { backgroundColor: c.surface }]}>
              <Feather name="layers" size={22} color={c.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.title, { color: c.text }]} numberOfLines={1}>Score factors</Text>
              <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>
                {[down ? `${down} pulling down` : null, up ? `${up} pushing up` : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={c.textMuted} />
          </Pressable>
        </Card>
        <Sheet visible={open} title="Score factors" onClose={() => setOpen(false)}>
          <Text style={[type.body, { color: c.textMuted }]}>{HELP}</Text>
          <FactorGroups factors={factors} />
        </Sheet>
      </>
    );
  }

  return (
    <Card style={scroll ? { flexShrink: 1, minHeight: 0 } : undefined}>
      <View style={s.head}>
        <View style={[s.tile, { backgroundColor: c.surface }]}>
          <Feather name="layers" size={22} color={c.primary} />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0 }}>
          <Text style={[type.title, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>Score factors</Text>
          <HelpTip title="Score factors" text={HELP} />
        </View>
      </View>
      <View style={[{ gap: spacing.lg }, scroll && ({ flexShrink: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 } as object)]}>
        <FactorGroups factors={factors} />
      </View>
    </Card>
  );
}

const s = {
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  tile: { width: 52, height: 52, borderRadius: 26, alignItems: 'center' as const, justifyContent: 'center' as const },
  item: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'flex-start' as const },
  itemTile: { width: 36, height: 36, borderRadius: radius.control - 4, alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: 2 },
  impact: { alignSelf: 'flex-start' as const, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, marginTop: 4 },
};
