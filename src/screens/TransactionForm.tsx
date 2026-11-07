import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Button } from '../components/Button';
import { DEFAULT_CATEGORY, activeCategories, allCategories } from '../domain/categories';
import { Segmented, ToggleRow } from '../components/Controls';
import { DateField } from '../components/DateField';
import { MoneyField, TextField } from '../components/Fields';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { addMonthsToKey, currentMonthKey, endOfMonth, formatDate, monthKey, monthLabel, todayISO } from '../domain/dates';
import { buildInvoices, defaultInvoiceKey, dueDateFor, findInvoice, openInvoiceKey, remaining } from '../domain/invoices';
import { formatMoney, newId } from '../domain/money';
import { buildOccurrences, currentBalance, fixedFieldsAt } from '../domain/transactions';
import { useStore } from '../store';
import { type, useColors } from '../theme';
import { OccurrenceFields, Transaction } from '../types';

type Mode = 'single' | 'fixed' | 'installments';
type Kind = 'expense' | 'income' | 'invoice';

/** Opens the form already targeted at a card (card expense or invoice payment). */
export interface FormPreset {
  kind: 'expense' | 'invoice' | 'refund';
  cardId?: string;
  invoiceKey?: string;
}

interface Props {
  visible: boolean;
  transaction?: Transaction;
  /** month (YYYY-MM) of the tapped occurrence, when editing a fixed transaction */
  occurrenceMonth?: string;
  preset?: FormPreset;
  onClose: () => void;
}

const installmentOptions = Array.from({ length: 47 }, (_, i) => ({ value: i + 2, label: `${i + 2}x` }));

const dayOptions = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `Day ${i + 1}` }));

export function TransactionForm({ visible, transaction, occurrenceMonth, preset, onClose }: Props) {
  const c = useColors();
  const { data, addTransaction, updateTransaction, updateFixed, archiveTransaction, addPayment } = useStore();
  const [scopeOpen, setScopeOpen] = useState(false);
  const [day, setDay] = useState(1);
  const editMonth = transaction?.fixed ? occurrenceMonth ?? monthKey(transaction.date) : '';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = !!transaction;
  const [kind, setKind] = useState<Kind>('expense');
  const [description, setDescription] = useState('');
  /** expense category (required for expenses) */
  const [category, setCategory] = useState('');
  const [cents, setCents] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<Mode>('single');
  const [installments, setInstallments] = useState(2);
  const [cardId, setCardId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [invoiceKey, setInvoiceKey] = useState('');
  /** invoice chosen for the card purchase */
  const [purchaseInvoice, setPurchaseInvoice] = useState('');
  const [tried, setTried] = useState(false);

  const occ = useMemo(() => buildOccurrences(data, addMonthsToKey(currentMonthKey(), 12)), [data]);
  const invoices = useMemo(() => buildInvoices(data, occ), [data, occ]);

  const pickInvoice = (card: string, key: string) => {
    const cardObj = data.cards.find((x) => x.id === card);
    setCardId(card);
    setInvoiceKey(key);
    setCents(cardObj ? remaining(findInvoice(invoices, cardObj, key)) : 0);
  };

  const pickCardForPayment = (card: string) => {
    const cardObj = data.cards.find((x) => x.id === card);
    if (cardObj) pickInvoice(card, defaultInvoiceKey(invoices, cardObj, todayISO()));
  };

  useEffect(() => {
    if (!visible) return;
    // fixed: shows the effective values of the tapped month (with per-month edits applied)
    const eff = transaction?.fixed ? fixedFieldsAt(transaction, occurrenceMonth ?? monthKey(transaction.date)) : undefined;
    setDescription(eff?.description ?? transaction?.description ?? '');
    setCategory(eff?.category ?? transaction?.category ?? (transaction && transaction.type === 'expense' ? DEFAULT_CATEGORY : ''));
    setCents(eff?.amount ?? transaction?.amount ?? 0);
    setDay(eff?.day ?? 1);
    setScopeOpen(false);
    setDate(transaction?.date ?? todayISO());
    setMode(transaction ? (transaction.fixed ? 'fixed' : transaction.installment ? 'installments' : 'single') : 'single');
    setInstallments(2);
    setConfirmed(transaction?.confirmed ?? false);
    setTried(false);
    setConfirmDelete(false);
    setKind(transaction?.type ?? (preset?.kind === 'refund' ? 'income' : preset?.kind) ?? 'expense');
    setCardId(transaction?.cardId ?? preset?.cardId ?? '');
    setInvoiceKey('');
    {
      const buyCard = data.cards.find((x) => x.id === (transaction?.cardId ?? preset?.cardId));
      setPurchaseInvoice(transaction?.invoiceKey ?? preset?.invoiceKey ?? (buyCard ? openInvoiceKey(buyCard, todayISO()) : ''));
    }
    if (!transaction && preset?.kind === 'invoice') {
      const card = data.cards.find((x) => x.id === preset.cardId);
      if (card) pickInvoice(card.id, preset.invoiceKey ?? defaultInvoiceKey(invoices, card, todayISO()));
    }
    // only resets on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, transaction, occurrenceMonth, preset]);

  // archived cards are not offered, unless this very purchase already uses one
  const pickable = data.cards.filter((x) => !x.archivedAt || x.id === transaction?.cardId || x.id === preset?.cardId);

  const changeKind = (k: Kind) => {
    setKind(k);
    if ((k === 'income') !== (kind === 'income')) setCategory('');
    if (k === 'invoice') {
      const first = pickable[0];
      const target = cardId && pickable.some((x) => x.id === cardId) ? cardId : preset?.cardId ?? first?.id;
      if (preset?.cardId && preset.invoiceKey) pickInvoice(preset.cardId, preset.invoiceKey);
      else if (target) pickCardForPayment(target);
    } else if (preset?.cardId) {
      setCardId(preset.cardId);
    } else if (k === 'income') {
      setCardId('');
    }
  };

  const invoiceMode = kind === 'invoice';
  const cardLocked = !!preset && !editing;
  const errors = {
    description: description.trim() ? undefined : 'Enter a description',
    category: kind === 'invoice' || (kind === 'income' && cardId !== '') || category ? undefined : 'Select a category',
    amount: cents > 0 ? undefined : 'Enter an amount greater than zero',
    card: cardId ? undefined : 'Select a card',
  };
  const valid = invoiceMode
    ? !errors.amount && !errors.card
    : !errors.description && !errors.amount && !errors.category;
  const cardOptions = [
    { value: '', label: 'Bank account' },
    ...pickable.map((card) => ({ value: card.id, label: card.name })),
  ];
  const payWith = cardId;
  const usesCard = (kind === 'expense' || kind === 'income') && cardId !== '';
  /** income on a card = refund: reduces the invoice */
  const isRefund = usesCard && kind === 'income';
  /** expenses and income have a category (card refunds do not) */
  const needsCategory = (kind === 'expense' || kind === 'income') && !isRefund;

  const payCard = data.cards.find((x) => x.id === cardId);
  const purchaseOptions = useMemo(() => {
    if (!payCard) return [];
    const open = openInvoiceKey(payCard, todayISO());
    const keys = Array.from({ length: 22 }, (_, i) => addMonthsToKey(open, i - 3));
    if (purchaseInvoice && !keys.includes(purchaseInvoice)) keys.push(purchaseInvoice);
    return keys.sort().map((key) => ({ value: key, label: `${monthLabel(key)} · due ${formatDate(dueDateFor(payCard, key))}` }));
  }, [payCard, purchaseInvoice]);
  const invoiceOptions = useMemo(() => {
    if (!payCard) return [];
    const keys = new Set(
      invoices.filter((i) => i.cardId === payCard.id && (remaining(i) > 0 || i.key === invoiceKey)).map((i) => i.key),
    );
    if (invoiceKey) keys.add(invoiceKey);
    if (keys.size === 0) keys.add(openInvoiceKey(payCard, todayISO()));
    return [...keys].sort().map((key) => ({
      value: key,
      label: `${monthLabel(key)} · remaining ${formatMoney(remaining(findInvoice(invoices, payCard, key)))}`,
    }));
  }, [invoices, payCard, invoiceKey]);

  /** Applies a fixed transaction edit in the chosen scope; type/card/invoice apply to the whole series. */
  const applyFixed = (scope: 'one' | 'forward', changes: OccurrenceFields) => {
    if (!transaction) return;
    updateFixed(transaction.id, editMonth, changes, scope, {
      type: kind as 'expense' | 'income',
      cardId: usesCard ? cardId : undefined,
      invoiceKey: usesCard ? purchaseInvoice : undefined,
    });
    setScopeOpen(false);
    onClose();
  };

  const pendingChanges = (): OccurrenceFields => {
    if (!transaction?.fixed) return {};
    const eff = fixedFieldsAt(transaction, editMonth);
    const c: OccurrenceFields = {};
    if (description.trim() !== eff.description) c.description = description.trim();
    if (needsCategory && category !== (eff.category ?? (kind === 'expense' ? DEFAULT_CATEGORY : ''))) c.category = category;
    if (cents !== eff.amount) c.amount = cents;
    if (day !== eff.day) c.day = day;
    return c;
  };

  const submit = () => {
    setTried(true);
    if (!valid) return;
    if (invoiceMode) {
      addPayment({ cardId, invoiceKey, amount: cents, date });
      onClose();
      return;
    }
    if (transaction?.fixed) {
      const eff = fixedFieldsAt(transaction, editMonth);
      const changes: OccurrenceFields = {};
      if (description.trim() !== eff.description) changes.description = description.trim();
      if (needsCategory && category !== (eff.category ?? (kind === 'expense' ? DEFAULT_CATEGORY : ''))) changes.category = category;
      if (cents !== eff.amount) changes.amount = cents;
      if (day !== eff.day) changes.day = day;
      if (Object.keys(changes).length > 0) {
        setScopeOpen(true);
        return;
      }
      applyFixed('forward', {});
      return;
    }
    if (transaction) {
      updateTransaction(transaction.id, {
        type: kind as 'expense' | 'income',
        description: description.trim(),
        category: needsCategory ? category : undefined,
        amount: cents,
        date,
        cardId: usesCard ? cardId : undefined,
          invoiceKey: usesCard ? purchaseInvoice : undefined,
        confirmed: usesCard ? false : confirmed,
      });
      onClose();
      return;
    }
    addTransaction({
      type: kind as 'expense' | 'income',
      description: description.trim(),
      category: needsCategory ? category : undefined,
      amount: cents,
      date,
      confirmed: usesCard ? false : confirmed,
      fixed: mode === 'fixed',
      cardId: usesCard ? cardId : undefined,
      invoiceKey: usesCard ? purchaseInvoice : undefined,
      installments: mode === 'installments' ? installments : 1,
    });
    onClose();
  };

  const title = editing
    ? 'Edit transaction'
    : invoiceMode
      ? 'Invoice payment'
      : preset?.kind === 'expense'
        ? 'New card expense'
        : preset?.kind === 'refund'
          ? 'Card refund'
          : 'New transaction';

  const kindOptions = [
    { value: 'expense' as Kind, label: 'Expense' },
    { value: 'income' as Kind, label: 'Income' },
    ...(pickable.length > 0 ? [{ value: 'invoice' as Kind, label: 'Pay card' }] : []),
  ];

  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={onClose}
      footer={
        editing ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmDelete(true)}
              style={({ pressed }) => ({ flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.label, { color: c.expense }]}>Delete</Text>
            </Pressable>
            <Button label="Save" icon="check" onPress={submit} />
          </>
        ) : (
          <>
            <Button label="Cancel" variant="secondary" onPress={onClose} flex />
            <Button label={invoiceMode ? 'Pay' : 'Save'} icon="check" onPress={submit} flex />
          </>
        )
      }
    >
      {!cardLocked && (
        <Segmented
          value={kind}
          onChange={changeKind}
          options={kindOptions}
          tint={{ expense: c.expense, income: c.income, invoice: c.primary }}
        />
      )}

      {invoiceMode ? (
        <>
          {!cardLocked && (
            <Select
              label="Card"
              value={cardId || undefined}
              options={pickable.map((card) => ({ value: card.id, label: card.name }))}
              onChange={pickCardForPayment}
              error={tried ? errors.card : undefined}
            />
          )}
          <Select
            label="Invoice"
            value={invoiceKey || undefined}
            options={invoiceOptions}
            onChange={(key) => payCard && pickInvoice(payCard.id, key)}
          />
          <MoneyField label="Amount paid" cents={cents} onChange={setCents} error={tried ? errors.amount : undefined} />
          <DateField label="Payment date" value={date} onChange={setDate} />
          <Text style={[type.body, { color: c.textMuted }]}>Source: account balance. The amount paid reduces the balance and the used limit.</Text>
        </>
      ) : (
        <>
          <TextField label="Description" value={description} onChangeText={setDescription} maxLength={100} error={tried ? errors.description : undefined} />
          {needsCategory && (
            <Select
              label="Category"
              value={category || undefined}
              options={[
                ...activeCategories(kind === 'income' ? 'income' : 'expense'),
                // an archived category stays selectable on the transaction that already has it
                ...allCategories(kind === 'income' ? 'income' : 'expense').filter((x) => x.archived && x.slug === category),
              ].map((x) => ({ value: x.slug, label: x.archived ? `${x.label} (archived)` : x.label }))}
              onChange={setCategory}
              placeholder="Select"
              error={tried ? errors.category : undefined}
            />
          )}
          <MoneyField label={mode === 'installments' && !editing ? 'Total amount' : editing && transaction?.installment ? 'Installment amount' : 'Amount'} cents={cents} onChange={setCents} error={tried ? errors.amount : undefined} />
          {editing && transaction?.fixed ? (
            <Select label="Day of month" value={day} options={dayOptions} onChange={setDay} />
          ) : (
            <DateField label={mode === 'fixed' ? 'Start date' : usesCard ? (isRefund ? 'Refund date' : 'Purchase date') : 'Date'} value={date} onChange={setDate} />
          )}
          {editing ? (
            <Text style={[type.body, { color: c.textMuted }]}>
              {transaction?.installment
                ? `Installment ${transaction.installment.index}/${transaction.installment.total}. Description, type and card apply to all installments; amount, date and status only to this one.`
                : transaction?.fixed
                  ? `Fixed transaction, editing ${monthLabel(editMonth)}. When saving, you choose whether the change applies only to this month or to the following ones too.`
                  : null}
            </Text>
          ) : isRefund ? null : (
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'single', label: 'One-time' },
                { value: 'fixed', label: 'Fixed' },
                { value: 'installments', label: 'Installments' },
              ]}
            />
          )}
          {mode === 'installments' && !editing && (
            <Select label="Installments" value={installments} options={installmentOptions} onChange={setInstallments} />
          )}
          {kind === 'expense' && pickable.length > 0 && !cardLocked && (
            <Select
              label="Pay with"
              value={payWith}
              options={cardOptions}
              onChange={(v) => {
                setCardId(v);
                const next = data.cards.find((x) => x.id === v);
                if (next) setPurchaseInvoice(openInvoiceKey(next, todayISO()));
              }}
            />
          )}
          {usesCard && (
            <Select
              label={mode === 'installments' && !editing ? 'First installment on invoice' : isRefund ? 'Apply to invoice' : 'Invoice'}
              value={purchaseInvoice}
              options={purchaseOptions}
              onChange={setPurchaseInvoice}
            />
          )}
          {usesCard && !isRefund && (
            <Text style={[type.body, { color: c.warning }]}>
              A card purchase is debt. Only buy what you can pay off on the full invoice, without installments.
            </Text>
          )}
          {!usesCard && !transaction?.fixed && (
            <ToggleRow
              label={kind === 'income' ? 'Already received' : 'Already paid'}
              hint={mode === 'single' ? undefined : 'Applies to the first transaction'}
              value={confirmed}
              onChange={setConfirmed}
            />
          )}
        </>
      )}

      <Sheet visible={scopeOpen} title="Change fixed transaction" onClose={() => setScopeOpen(false)}>
        <Text style={[type.body, { color: c.text }]}>
          You changed "{description.trim() || transaction?.description}" in {editMonth ? monthLabel(editMonth) : ''}. Apply to:
        </Text>
        <Button label="This and following" icon="repeat" onPress={() => applyFixed('forward', pendingChanges())} />
        <Button label={`Only this (${editMonth ? monthLabel(editMonth) : ''})`} variant="secondary" onPress={() => applyFixed('one', pendingChanges())} />
        <Button label="Cancel" variant="tertiary" onPress={() => setScopeOpen(false)} />
      </Sheet>

      <Sheet
        visible={confirmDelete}
        title="Archive transaction"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} flex />
            <Button
              label="Archive"
              danger
              flex
              onPress={() => {
                if (transaction) archiveTransaction(transaction.id);
                setConfirmDelete(false);
                onClose();
              }}
            />
          </>
        }
      >
        <Text style={[type.body, { color: c.text }]}>
          {transaction?.installment
            ? `All ${transaction.installment.total} installments of "${transaction.description}" will be archived.`
            : transaction?.fixed
              ? `The recurrence of "${transaction.description}" will be archived for all months.`
              : `"${transaction?.description}" will be archived.`}
          {' '}It leaves your lists and totals, but nothing is deleted.
        </Text>
      </Sheet>
    </Sheet>
  );
}
