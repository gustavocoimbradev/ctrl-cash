import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ToggleRow } from '../components/Controls';
import { Sheet } from '../components/Sheet';
import { t } from '../i18n';
import { cardColor } from '../domain/cards';
import { currentMonthKey, todayISO } from '../domain/dates';
import { buildInvoices, cardUsed } from '../domain/invoices';
import { formatMoney } from '../domain/money';
import { buildOccurrences } from '../domain/transactions';
import { useStore } from '../store';
import { colors as c, radius, spacing, type } from '../theme';
import { CreditCard } from '../types';
import { CardForm } from './CardForm';

/** Card list with debt, limit and due date; tap a card to edit it. */
function CardsList({ onEdit }: { onEdit: (card: CreditCard) => void }) {
  const { data } = useStore();
  const [showArchived, setShowArchived] = useState(false);
  const used = useMemo(() => {
    const invoices = buildInvoices(data, buildOccurrences(data, currentMonthKey()));
    return new Map(data.cards.map((x) => [x.id, cardUsed(invoices, x.id, todayISO())]));
  }, [data]);

  return (
    <>
      <Text style={[type.body, { color: c.textMuted }]}>
        {t('A card is debt, not extra income. Add your cards to track what you owe and pay off the invoices.')}
      </Text>
      {data.cards.map((card, ci) => ({ card, ci })).filter(({ card }) => !card.archivedAt || showArchived).map(({ card, ci }) => {
        const debt = used.get(card.id) ?? 0;
        return (
          <Pressable
            key={card.id}
            accessibilityRole="button"
            accessibilityLabel={t('Edit card {name}', { name: card.name })}
            onPress={() => onEdit(card)}
            style={({ pressed, hovered }: any) => [s.row, { backgroundColor: hovered ? c.surfaceAlt : c.surface, opacity: pressed ? 0.7 : card.archivedAt ? 0.6 : 1 }]}
          >
            <View style={[s.tile, { backgroundColor: `${cardColor(card, ci)}26` }]}>
              <Feather name="credit-card" size={20} color={cardColor(card, ci)} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{card.archivedAt ? t('{name}  ·  archived', { name: card.name }) : card.name}</Text>
              <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{t('Limit {limit} · due day {day}', { limit: formatMoney(card.limit), day: card.dueDay })}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[type.label, { color: debt > 0 ? c.expense : c.text }]}>{formatMoney(debt)}</Text>
              <Text style={[type.body, { color: c.textMuted }]}>{t('debt')}</Text>
            </View>
          </Pressable>
        );
      })}
      {data.cards.some((x) => x.archivedAt) && (
        <ToggleRow label={t('Show archived cards')} hint={t('Archived cards keep their history; restore one from its edit screen.')} value={showArchived} onChange={setShowArchived} />
      )}
    </>
  );
}

/** Card management inline (phone tab): the list and, at the end, the New card button. */
export function CardsContent() {
  const [form, setForm] = useState<{ card?: CreditCard } | null>(null);
  return (
    <>
      <CardsList onEdit={(card) => setForm({ card })} />
      <Button label={t('New card')} icon="plus" variant="secondary" onPress={() => setForm({})} />
      <CardForm visible={!!form} card={form?.card} onClose={() => setForm(null)} />
    </>
  );
}

/** Card management in a dialog (desktop): the New card button is pinned in the footer, like the header. */
export function CardsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [form, setForm] = useState<{ card?: CreditCard } | null>(null);
  return (
    <Sheet screen visible={visible} title={t('Cards')} onClose={onClose} footer={<Button label={t('New card')} icon="plus" onPress={() => setForm({})} flex />}>
      <CardsList onEdit={(card) => setForm({ card })} />
      <CardForm visible={!!form} card={form?.card} onClose={() => setForm(null)} />
    </Sheet>
  );
}

const s = {
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, padding: spacing.md, borderRadius: radius.control, minHeight: 64 },
  tile: { width: 40, height: 40, borderRadius: radius.control - 2, alignItems: 'center' as const, justifyContent: 'center' as const },
};
