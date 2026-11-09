import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { AreaKey, areaSummary } from '../domain/areas';
import { shortDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { getLocale, t } from '../i18n';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';
import { Transaction } from '../types';
import { FormPreset } from './TransactionForm';

type Icon = keyof typeof Feather.glyphMap;

const AREAS: Record<AreaKey, { icon: Icon; color: string }> = {
  subscriptions: { icon: 'repeat', color: '#C25BD6' },
  bills: { icon: 'file-text', color: '#4F46E5' },
  delivery: { icon: 'package', color: '#F97316' },
};

/** A small share keeps a decimal (0.4%), so it never reads as a flat 0%. */
const pct = (v: number) => `${(v * 100).toLocaleString(getLocale(), { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`;

/** What to say when there is nothing in the area yet (not an insight: those live in the score dialog). */
const emptyText = (area: AreaKey) =>
  area === 'subscriptions'
    ? t('No subscriptions yet. Add the ones you pay every month to see what they cost you.')
    : area === 'bills'
      ? t('No bills yet. Add rent, electricity, water, internet... to keep them all in one place.')
      : t('No delivery in the last 3 months. Cooking at home is the best choice for your wallet and your score.');

/**
 * A focused view of one kind of spending (subscriptions, utility bills or delivery): what it costs and the items themselves,
 * with a way to add more. Insights about it are not here: they live in the dialog about what affects the score. Everything here is also in the generic list.
 */
export function AreaSheet({ area, visible, onClose, onAdd, onEdit }: { area: AreaKey; visible: boolean; onClose: () => void; onAdd: (preset: FormPreset) => void; onEdit: (tx: Transaction, month?: string) => void }) {
  const c = useColors();
  const { data } = useStore();
  const cfg = AREAS[area];
  const s = visible ? areaSummary(data, area) : null;
  const cardName = (id?: string) => (id ? data.cards.find((x) => x.id === id)?.name : undefined);

  const title = area === 'subscriptions' ? t('Subscriptions') : area === 'bills' ? t('Utility bills') : t('Delivery');
  const addLabel = area === 'subscriptions' ? t('New subscription') : area === 'bills' ? t('New bill') : t('New order');
  const tiles = area === 'delivery'
    ? [{ label: t('Per month'), value: s ? formatMoney(s.monthly) : '' }, { label: t('Per year'), value: s ? formatMoney(s.yearly) : '' }, { label: t('Of income'), value: s && s.income > 0 ? pct(s.share) : '-' }]
    : [{ label: t('Per month'), value: s ? formatMoney(s.monthly) : '' }, { label: t('Per year'), value: s ? formatMoney(s.yearly) : '' }, { label: t('Of income'), value: s && s.income > 0 ? pct(s.share) : '-' }];

  return (
    <Sheet
      screen
      visible={visible}
      title={title}
      onClose={onClose}
      footer={<Button label={addLabel} icon="plus" onPress={() => onAdd({ kind: 'expense', category: area, fixed: area !== 'delivery', confirmed: area === 'bills' ? false : undefined })} flex />}
    >
      {s ? (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {tiles.map((x) => (
              <View key={x.label} style={{ flex: 1, minWidth: 0, backgroundColor: c.surface, borderRadius: radius.control, padding: spacing.md, gap: 2 }}>
                <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{x.label}</Text>
                <Text style={[type.label, { color: cfg.color }]} numberOfLines={1}>{x.value}</Text>
              </View>
            ))}
          </View>

          {s.items.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{emptyText(area)}</Text> : null}

          {s.items.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={[type.title, { color: c.text }]}>{area === 'delivery' ? t('Recent orders') : t('Your list')}</Text>
              {s.items.map((i) => (
                <Pressable
                  key={i.key}
                  accessibilityRole="button"
                  accessibilityLabel={t('Open {title}', { title: i.description })}
                  onPress={() => onEdit(i.transaction, i.month)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{i.description}</Text>
                    <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>
                      {[area === 'delivery' ? shortDate(new Date(`${i.date}T12:00:00`).getTime(), true) : t('Day {day}', { day: i.day }), cardName(i.cardId)].filter(Boolean).join(' · ')}
                      {area !== 'delivery' && i.paid ? ` · ${t('Paid')}` : ''}
                    </Text>
                  </View>
                  <Text style={[type.label, { color: c.text }]}>{formatMoney(i.amount)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
