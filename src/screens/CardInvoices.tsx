import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { MoneyField } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { addMonthsToKey, currentMonthKey, formatDate, monthLabel, todayISO } from '../domain/dates';
import { Invoice, buildInvoices, dueDateFor, findInvoice, openInvoiceKey, remaining } from '../domain/invoices';
import { formatMoney } from '../domain/money';
import { buildOccurrences } from '../domain/transactions';
import { t } from '../i18n';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';
import { CreditCard } from '../types';

/**
 * The invoices of a card, one line each with just the amount (no detail), and a way to readjust one: the person types
 * what the bank says the invoice is, and the difference becomes an adjustment charge (more) or credit (less) on it.
 */
export function CardInvoices({ card }: { card: CreditCard }) {
  const c = useColors();
  const { data, addTransaction } = useStore();
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [value, setValue] = useState(0);

  const open = openInvoiceKey(card, todayISO());
  const next = addMonthsToKey(open, 1);
  const invoices = useMemo(() => buildInvoices(data, buildOccurrences(data, addMonthsToKey(currentMonthKey(), 3))), [data]);
  /** newest first: the next invoice, the open one and every earlier one that has something on it; never the far future */
  const list: Invoice[] = useMemo(() => {
    const keys = new Set([open, next, ...invoices.filter((i) => i.cardId === card.id && i.key <= next && (i.total !== 0 || i.paid > 0)).map((i) => i.key)]);
    return [...keys].sort().reverse().map((key) => findInvoice(invoices, card, key));
  }, [invoices, card, open, next]);

  const current = adjusting ? findInvoice(invoices, card, adjusting) : null;
  const diff = current ? value - current.total : 0;
  const archived = !!card.archivedAt;

  const startAdjust = (inv: Invoice) => {
    setValue(Math.max(inv.total, 0));
    setAdjusting(inv.key);
  };
  const save = () => {
    if (!current || diff === 0) return;
    addTransaction({
      type: diff > 0 ? 'expense' : 'income',
      description: t('Invoice adjustment'),
      amount: Math.abs(diff),
      date: todayISO(),
      confirmed: false,
      fixed: false,
      cardId: card.id,
      invoiceKey: current.key,
      category: diff > 0 ? 'other' : 'refund',
      installments: 1,
    });
    setAdjusting(null);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.title, { color: c.text }]}>{t('Invoices')}</Text>
      {list.map((inv) => {
        const paid = inv.total > 0 && remaining(inv) === 0;
        return (
          <View key={inv.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, backgroundColor: c.surface, borderRadius: radius.control, paddingLeft: spacing.lg, paddingRight: spacing.xs }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{monthLabel(inv.key)}</Text>
              <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>
                {inv.key === open ? t('Open now') : t('Due {date}', { date: formatDate(dueDateFor(card, inv.key)) })}
                {paid ? ` · ${t('Paid')}` : ''}
              </Text>
            </View>
            <Text style={[type.label, { color: inv.total > 0 && !paid ? c.expense : c.text }]}>{formatMoney(inv.total)}</Text>
            {!archived ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('Adjust invoice')} onPress={() => startAdjust(inv)} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={[type.label, { color: c.primary }]}>{t('Adjust')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Sheet
        visible={!!current}
        title={current ? t('Adjust invoice') : ''}
        onClose={() => setAdjusting(null)}
        footer={
          <>
            <Button label={t('Cancel')} variant="secondary" onPress={() => setAdjusting(null)} flex />
            <Button label={t('Adjust')} icon="check" onPress={save} disabled={diff === 0} flex />
          </>
        }
      >
        {current ? (
          <View style={{ gap: spacing.lg }}>
            <Text style={[type.body, { color: c.text }]}>{t('Type the total of the {month} invoice as your bank shows it. The difference is added to it as an adjustment.', { month: monthLabel(current.key) })}</Text>
            <MoneyField label={t('Invoice total')} cents={value} onChange={setValue} />
            <Text style={[type.body, { color: diff === 0 ? c.textMuted : diff > 0 ? c.expense : c.income }]}>
              {diff === 0 ? t('Nothing to adjust.') : diff > 0 ? t('Adds {amount} as an adjustment charge.', { amount: formatMoney(diff) }) : t('Takes off {amount} as an adjustment credit.', { amount: formatMoney(-diff) })}
            </Text>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
