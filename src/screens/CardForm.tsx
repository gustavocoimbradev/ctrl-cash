import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Field, MoneyField, TextField } from '../components/Fields';
import { CARD_COLORS, cardColorLabel } from '../domain/cards';
import { Select } from '../components/Select';
import { CardInvoices } from './CardInvoices';
import { Sheet } from '../components/Sheet';
import { t } from '../i18n';
import { useStore } from '../store';
import { type, useColors } from '../theme';
import { CreditCard } from '../types';

export function CardForm({ visible, card, onClose }: { visible: boolean; card?: CreditCard; onClose: () => void }) {
  const c = useColors();
  const dayOptions = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('Day {day}', { day: i + 1 }) }));
  const { data, saveCard, archiveCard, restoreCard } = useStore();
  const [color, setColor] = useState<string>(CARD_COLORS[0].value);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(0);
  const [dueDay, setDueDay] = useState(17);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(card?.name ?? '');
      setLimit(card?.limit ?? 0);
      setDueDay(card?.dueDay ?? 17);
      // new card: the first palette color not yet used
      setColor(card?.color ?? CARD_COLORS.find((x) => !data.cards.some((cd) => cd.color === x.value))?.value ?? CARD_COLORS[0].value);
      setTried(false);
      setConfirmArchive(false);
    }
  }, [visible, card]);

  const nameError = name.trim() ? undefined : t('Enter the card name');
  const limitError = limit > 0 ? undefined : t('Enter the limit');

  const submit = () => {
    setTried(true);
    if (nameError || limitError) return;
    saveCard({ id: card?.id, name: name.trim(), limit, dueDay, color });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={card ? t('Edit card') : t('New card')}
      onClose={onClose}
      footer={
        card ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (card.archivedAt) {
                  restoreCard(card.id);
                  onClose();
                } else setConfirmArchive(true);
              }}
              style={({ pressed }) => ({ flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.label, { color: card.archivedAt ? c.primary : c.expense }]}>{card.archivedAt ? t('Restore') : t('Archive')}</Text>
            </Pressable>
            <Button label={t('Save')} icon="check" onPress={submit} />
          </>
        ) : (
          <>
            <Button label={t('Cancel')} variant="secondary" onPress={onClose} flex />
            <Button label={t('Save')} icon="check" onPress={submit} flex />
          </>
        )
      }
    >
      <TextField label={t('Card name')} value={name} onChangeText={setName} maxLength={60} error={tried ? nameError : undefined} />
      <MoneyField label={t('Total limit')} cents={limit} onChange={setLimit} error={tried ? limitError : undefined} />
      <Select label={t('Due day')} value={dueDay} options={dayOptions} onChange={setDueDay} />
      <Field label={t('Color')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {CARD_COLORS.map((x) => (
            <Pressable
              key={x.value}
              accessibilityRole="button"
              accessibilityLabel={t('Color {name}', { name: cardColorLabel(x.label) })}
              accessibilityState={{ selected: color === x.value }}
              onPress={() => setColor(x.value)}
              style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: x.value, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1, borderWidth: color === x.value ? 3 : 0, borderColor: c.card })}
            >
              {color === x.value && <Feather name="check" size={20} color="#FFFFFF" />}
            </Pressable>
          ))}
        </View>
      </Field>

      {card ? <CardInvoices card={card} /> : null}

      <Sheet
        visible={confirmArchive}
        title={t('Archive card')}
        onClose={() => setConfirmArchive(false)}
        footer={
          <>
            <Button label={t('Cancel')} variant="secondary" onPress={() => setConfirmArchive(false)} flex />
            <Button
              label={t('Archive')}
              danger
              flex
              onPress={() => {
                if (card) archiveCard(card.id);
                setConfirmArchive(false);
                onClose();
              }}
            />
          </>
        }
      >
        <Text style={[type.body, { color: c.text }]}>
          {t('The card "{name}" stops being offered for new purchases. Its transactions, installments, invoices and payments stay exactly as they are, and you can restore it any time.', { name: card?.name ?? '' })}
        </Text>
      </Sheet>
    </Sheet>
  );
}
