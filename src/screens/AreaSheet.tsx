import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ByClaude } from '../components/ClaudeMark';
import { Sheet } from '../components/Sheet';
import { AreaItem, AreaKey, areaSummary } from '../domain/areas';
import { currentMonthKey, monthName, shortDate } from '../domain/dates';
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
  /** delivery history: which years and months were opened or closed by hand (the current year and month start open) */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const s = visible ? areaSummary(data, area) : null;
  const cardName = (id?: string) => (id ? data.cards.find((x) => x.id === id)?.name : undefined);

  const currentYear = Number(currentMonthKey().slice(0, 4));
  const countText = (n: number) => (n === 1 ? t('One order') : t('{n} orders', { n }));
  const renderItem = (i: AreaItem) => (
    <Pressable
      key={i.key}
      accessibilityRole="button"
      accessibilityLabel={t('Open {title}', { title: i.description })}
      onPress={() => onEdit(i.transaction, i.month)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[type.label, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>{i.description}</Text>
          {i.transaction.source === 'claude' ? <ByClaude /> : null}
        </View>
        <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>
          {[area === 'delivery' ? shortDate(new Date(`${i.date}T12:00:00`).getTime(), true) : t('Day {day}', { day: i.day }), cardName(i.cardId)].filter(Boolean).join(' · ')}
          {area !== 'delivery' && i.paid ? ` · ${t('Paid')}` : ''}
        </Text>
      </View>
      <Text style={[type.label, { color: c.text }]}>{formatMoney(i.amount)}</Text>
    </Pressable>
  );

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

          {s.items.length > 0 && area === 'delivery' ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={[type.title, { color: c.text }]}>{t('Orders')}</Text>
              {groupByYear(s.items).map((y) => {
                const yKey = `y-${y.year}`;
                const yOpen = toggled[yKey] ?? y.year === currentYear;
                return (
                  <View key={yKey} style={{ gap: spacing.xs }}>
                    <GroupHeader open={yOpen} label={String(y.year)} detail={`${countText(y.count)} · ${formatMoney(y.total)}`} onPress={() => setToggled((m) => ({ ...m, [yKey]: !yOpen }))} />
                    {yOpen
                      ? y.months.map((m) => {
                          const mKey = `m-${m.key}`;
                          const mOpen = toggled[mKey] ?? m.key === currentMonthKey();
                          return (
                            <View key={mKey} style={{ gap: spacing.xs, marginLeft: spacing.md }}>
                              <GroupHeader sub open={mOpen} label={monthName(Number(m.key.slice(5, 7)))} detail={`${countText(m.items.length)} · ${formatMoney(m.total)}`} onPress={() => setToggled((x) => ({ ...x, [mKey]: !mOpen }))} />
                              {mOpen ? m.items.map(renderItem) : null}
                            </View>
                          );
                        })
                      : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          {s.items.length > 0 && area !== 'delivery' ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={[type.title, { color: c.text }]}>{t('Your list')}</Text>
              {s.items.map(renderItem)}
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

/** Orders by year, and inside each year by month, newest first, with their totals. */
function groupByYear(items: AreaItem[]) {
  const years = new Map<number, Map<string, AreaItem[]>>();
  for (const i of items) {
    const key = i.date.slice(0, 7);
    const year = Number(key.slice(0, 4));
    const months = years.get(year) ?? new Map<string, AreaItem[]>();
    months.set(key, [...(months.get(key) ?? []), i]);
    years.set(year, months);
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => {
      const list = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, its]) => ({ key, items: its, total: its.reduce((s, x) => s + x.amount, 0) }));
      return { year, months: list, count: list.reduce((s, m) => s + m.items.length, 0), total: list.reduce((s, m) => s + m.total, 0) };
    });
}

/** A folding header (a year, or a month inside it): its name, how many orders and how much, and a chevron. */
function GroupHeader({ label, detail, open, onPress, sub }: { label: string; detail: string; open: boolean; onPress: () => void; sub?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <Feather name={open ? 'chevron-down' : 'chevron-right'} size={20} color={c.textMuted} />
      <Text style={[sub ? type.label : type.title, { color: c.text, flex: 1 }]} numberOfLines={1}>{label}</Text>
      <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{detail}</Text>
    </Pressable>
  );
}
