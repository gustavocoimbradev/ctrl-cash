import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ByClaude } from '../components/ClaudeMark';
import { Sheet } from '../components/Sheet';
import { BarChart } from '../components/Charts';
import { debtsSummary, debtsTimeline } from '../domain/areas';
import { formatDate, monthLabel, monthName } from '../domain/dates';
import { formatMoney, formatMoneyShort } from '../domain/money';
import { getLocale, t } from '../i18n';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';
import { Transaction } from '../types';
import { FormPreset } from './TransactionForm';

/** A small share keeps a decimal (0.4%), so it never reads as a flat 0%. */
const pct = (v: number) => `${(v * 100).toLocaleString(getLocale(), { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`;

/**
 * Debts: everything being paid in installments, on a card or not. What is owed in all, what falls due this month and, for each
 * purchase, how many installments are left and when it ends. Tapping one opens it (all its installments move together).
 */
export function DebtsSheet({ visible, onClose, onAdd, onEdit }: { visible: boolean; onClose: () => void; onAdd: (preset: FormPreset) => void; onEdit: (tx: Transaction, month?: string) => void }) {
  const c = useColors();
  const { data } = useStore();
  const s = visible ? debtsSummary(data) : null;
  const timeline = visible ? debtsTimeline(data) : [];
  /** one color for everything; what is already paid is the lighter part */
  const bars = timeline.map((m, i) => {
    const mi = Number(m.key.slice(5, 7)) - 1;
    return {
      label: `${monthName(mi + 1).slice(0, 3)}${mi === 0 || i === 0 ? ` ${m.key.slice(2, 4)}` : ''}`,
      segments: [...(m.settled > 0 ? [{ value: m.settled, color: c.expense, paid: true }] : []), ...(m.debt > 0 ? [{ value: m.debt, color: c.expense }] : [])],
    };
  });
  // is it going down or up? the next 3 months against the 3 after them
  const nextSum = (from: number) => timeline.slice(6 + from, 9 + from).reduce((a, m) => a + m.debt, 0);
  const a = nextSum(0);
  const b = nextSum(3);
  const trend = a + b <= 0 ? null : b < a * 0.9 ? 'down' : b > a * 1.1 ? 'up' : 'flat';
  const cardName = (id?: string) => (id ? data.cards.find((x) => x.id === id)?.name : undefined);
  const tiles = s
    ? [
        { label: t('Owed'), value: formatMoneyShort(s.owed) },
        { label: t('Due this month'), value: formatMoneyShort(s.thisMonth) },
        { label: t('Of income'), value: s.income > 0 ? pct(s.share) : '-' },
      ]
    : [];

  return (
    <Sheet screen visible={visible} title={t('Debts')} onClose={onClose} footer={<Button label={t('New debt')} icon="plus" onPress={() => onAdd({ kind: 'expense', category: 'debts' })} flex />}>
      {s ? (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {tiles.map((x) => (
              <View key={x.label} style={{ flex: 1, minWidth: 0, backgroundColor: c.surface, borderRadius: radius.control, padding: spacing.md, gap: 2 }}>
                <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{x.label}</Text>
                <Text style={[type.label, { color: c.expense }]} numberOfLines={1}>{x.value}</Text>
              </View>
            ))}
          </View>
          {timeline.some((m) => m.debt + m.settled > 0) ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={[type.title, { color: c.text }]}>{t('How your debts evolve')}</Text>
              <BarChart groups={bars} />
              {trend ? (
                <Text style={[type.body, { color: trend === 'down' ? c.income : trend === 'up' ? c.expense : c.textMuted }]}>
                  {trend === 'down' ? t('What you owe falls over the next months.') : trend === 'up' ? t('What you owe grows over the next months.') : t('What you owe stays about the same over the next months.')}
                </Text>
              ) : null}
            </View>
          ) : null}
          {s.items.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('You owe nothing right now.')}</Text> : null}
          {s.items.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              {s.items.map((i) => (
                <Pressable
                  key={i.key}
                  accessibilityRole="button"
                  accessibilityLabel={t('Open {title}', { title: i.description })}
                  onPress={() => onEdit(i.transaction, i.month)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[type.label, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>{i.description}</Text>
                      {i.transaction.source === 'claude' ? <ByClaude /> : null}
                    </View>
                    <Text style={[type.body, { color: c.textMuted }]} numberOfLines={2}>
                      {[i.total > 1 ? t('{left} of {total} left · ends {month}', { left: i.left, total: i.total, month: monthLabel(i.endsAt) }) : t('Due {date}', { date: formatDate(i.dueDate) }), cardName(i.cardId)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[type.label, { color: c.text }]}>{formatMoney(i.remaining)}</Text>
                    {i.total > 1 ? <Text style={[type.body, { color: c.textMuted }]}>{t('{amount} each', { amount: formatMoney(i.next) })}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
