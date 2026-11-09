import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { debtsSummary } from '../domain/areas';
import { monthLabel } from '../domain/dates';
import { formatMoney } from '../domain/money';
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
  const cardName = (id?: string) => (id ? data.cards.find((x) => x.id === id)?.name : undefined);
  const tiles = s
    ? [
        { label: t('Owed'), value: formatMoney(s.owed) },
        { label: t('Due this month'), value: formatMoney(s.thisMonth) },
        { label: t('Of income'), value: s.income > 0 ? pct(s.share) : '-' },
      ]
    : [];

  return (
    <Sheet screen visible={visible} title={t('Debts')} onClose={onClose} footer={<Button label={t('New installment purchase')} icon="plus" onPress={() => onAdd({ kind: 'expense', installments: true })} flex />}>
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
          {s.items.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('Nothing in installments right now.')}</Text> : null}
          {s.items.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={[type.title, { color: c.text }]}>{t('In installments')}</Text>
              {s.items.map((i) => (
                <Pressable
                  key={i.groupId}
                  accessibilityRole="button"
                  accessibilityLabel={t('Open {title}', { title: i.description })}
                  onPress={() => onEdit(i.transaction, i.month)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{i.description}</Text>
                    <Text style={[type.body, { color: c.textMuted }]} numberOfLines={2}>
                      {[t('{left} of {total} left · ends {month}', { left: i.left, total: i.total, month: monthLabel(i.endsAt) }), cardName(i.cardId)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[type.label, { color: c.text }]}>{formatMoney(i.remaining)}</Text>
                    <Text style={[type.body, { color: c.textMuted }]}>{t('{amount} each', { amount: formatMoney(i.next) })}</Text>
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
