import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '../components/Button';
import { MoneyField, TextField } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { CARD_COLORS, openInvoiceKey } from '../domain/cards';
import { addMonthsToKey, daysInMonth, monthLabel, parseISO, toISO, todayISO } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { t } from '../i18n';
import { PrefsFields } from '../components/PrefsFields';
import { usePrefs } from '../store/prefs';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';

type Icon = keyof typeof Feather.glyphMap;

/** Something the person can pick: a name, an icon, the category it files under and the usual day of the month. */
interface Preset {
  id: string;
  label: string;
  icon: Icon;
  category?: string;
  day: number;
  /** typed by the person: shown and saved exactly as typed, never translated */
  custom?: boolean;
}

/** The name of a preset in the language on screen (what the person typed stays as typed). */
const labelOf = (p: Preset) => (p.custom ? p.label : t(p.label));

const SALARY: Preset = { id: 'salary', label: 'Salary', icon: 'briefcase', category: 'salary', day: 5 };

const OTHER_INCOME: Preset[] = [
  { id: 'freelance', label: 'Freelance', icon: 'edit-3', category: 'freelance', day: 15 },
  { id: 'rent-in', label: 'Rent received', icon: 'home', day: 5 },
];

const BILLS: Preset[] = [
  { id: 'rent', label: 'Rent', icon: 'home', category: 'bills', day: 5 },
  { id: 'condo', label: 'Condo fee', icon: 'grid', category: 'bills', day: 10 },
  { id: 'water', label: 'Water', icon: 'droplet', category: 'bills', day: 10 },
  { id: 'electricity', label: 'Electricity', icon: 'zap', category: 'bills', day: 10 },
  { id: 'gas', label: 'Cooking gas', icon: 'wind', category: 'bills', day: 10 },
  { id: 'internet', label: 'Internet', icon: 'wifi', category: 'bills', day: 10 },
  { id: 'phone', label: 'Phone', icon: 'smartphone', category: 'bills', day: 10 },
  { id: 'groceries', label: 'Groceries', icon: 'shopping-cart', category: 'groceries', day: 1 },
  { id: 'butcher', label: 'Butcher', icon: 'shopping-bag', category: 'butcher', day: 1 },
  { id: 'fuel', label: 'Fuel', icon: 'navigation', category: 'car', day: 1 },
  { id: 'health-plan', label: 'Health plan', icon: 'heart', category: 'health', day: 10 },
  { id: 'school', label: 'School or courses', icon: 'book', category: 'education', day: 10 },
  { id: 'gym', label: 'Gym', icon: 'activity', category: 'health', day: 10 },
];

/** Fixed charges that usually sit on a credit card. */
const CARD_FIXED: Preset[] = [
  { id: 'cf-netflix', label: 'Netflix', icon: 'tv', category: 'subscriptions', day: 10 },
  { id: 'cf-spotify', label: 'Spotify', icon: 'music', category: 'subscriptions', day: 10 },
  { id: 'cf-youtube', label: 'YouTube Premium', icon: 'play-circle', category: 'subscriptions', day: 10 },
  { id: 'cf-prime', label: 'Prime Video', icon: 'film', category: 'subscriptions', day: 10 },
  { id: 'cf-cloud', label: 'Cloud storage', icon: 'cloud', category: 'subscriptions', day: 10 },
  { id: 'cf-gym', label: 'Gym', icon: 'activity', category: 'health', day: 10 },
  { id: 'cf-phone', label: 'Phone', icon: 'smartphone', category: 'bills', day: 10 },
  { id: 'cf-internet', label: 'Internet', icon: 'wifi', category: 'bills', day: 10 },
];

interface Installment {
  id: string;
  label: string;
  /** cents per installment */
  value: number;
  /** installments still to pay, counting the one on the current invoice */
  left: number;
}

interface Entry {
  cents: number;
  day: number;
}

/** After "Clear everything": the setup is owed again. */
export function resetOnboardingSeen(uid: string) {
  try {
    if (Platform.OS === 'web') window.localStorage.removeItem(`ctrlcash:onboarding:${uid}`);
  } catch {
    // nothing to reset
  }
}

/** Remembers on this device that the person already went through (or skipped) the first-access setup. */
const key = (uid: string) => `ctrlcash:onboarding:${uid}`;
export function onboardingSeen(uid: string): boolean {
  try {
    return Platform.OS !== 'web' || window.localStorage.getItem(key(uid)) === '1';
  } catch {
    return false;
  }
}
export function markOnboardingSeen(uid: string) {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(key(uid), '1');
  } catch {
    // private window: it just asks again next time
  }
}

/** One screen = one decision: a round icon, a question, a hint and the thing to answer. */
function Screen({ icon, title, hint, children }: { icon: Icon; title: string; hint?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={s.screen}>
      <View style={[s.badge, { backgroundColor: 'rgba(45,85,217,0.10)' }]}>
        <Feather name={icon} size={30} color={c.primary} />
      </View>
      <Text style={[type.title, s.question, { color: c.text }]}>{title}</Text>
      {hint ? <Text style={[type.body, s.hint, { color: c.textMuted }]}>{hint}</Text> : null}
      <View style={s.answer}>{children}</View>
    </View>
  );
}

/** Tap-to-pick tiles (no checkboxes): the picked ones get a blue border and a soft fill. */
function Tiles({ items, picked, onToggle, onAdd }: { items: Preset[]; picked: string[]; onToggle: (id: string) => void; onAdd: (label: string) => void }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const cols = width < 520 ? 2 : 3;
  const [name, setName] = useState('');
  const add = () => {
    const label = name.trim();
    if (!label) return;
    onAdd(label);
    setName('');
  };
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={s.grid}>
        {items.map((p) => {
          const on = picked.includes(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={labelOf(p)}
              onPress={() => onToggle(p.id)}
              style={[
                s.tile,
                { width: `${100 / cols - 2}%` as `${number}%`, borderColor: on ? c.primary : 'transparent', backgroundColor: on ? 'rgba(45,85,217,0.08)' : c.surface },
                Platform.OS === 'web' && ({ transitionProperty: 'background-color, border-color', transitionDuration: '140ms', cursor: 'pointer' } as object),
              ]}
            >
              <Feather name={on ? 'check-circle' : p.icon} size={24} color={on ? c.primary : c.textMuted} />
              <Text style={[type.body, { color: c.text, fontWeight: on ? '600' : '400', textAlign: 'center' }]} numberOfLines={2}>{labelOf(p)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.addRow}>
        <View style={{ flex: 1 }}>
          <TextField label={t('Something else?')} value={name} onChangeText={setName} placeholder={t('Type a name')} maxLength={40} onSubmitEditing={add} returnKeyType="done" />
        </View>
        <Button label={t('Add')} icon="plus" variant="secondary" onPress={add} disabled={!name.trim()} />
      </View>
    </View>
  );
}

/** Calendar-style day of the month, 1 to 31 in rows of seven. */
function DayPicker({ day, onChange }: { day: number; onChange: (d: number) => void }) {
  const c = useColors();
  return (
    <View style={s.days}>
      {Array.from({ length: 31 }, (_, k) => k + 1).map((d) => {
        const on = d === day;
        return (
          <View key={d} style={s.dayCell}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t('Day {day}', { day: d })}
              onPress={() => onChange(d)}
              style={[s.day, { backgroundColor: on ? c.primary : 'transparent' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as object)]}
            >
              <Text style={[type.label, { color: on ? '#FFFFFF' : c.text }]}>{d}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** Amount and day, on one screen. */
function AmountAnswer({ entry, onChange }: { entry: Entry; onChange: (e: Entry) => void }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.xl }}>
      <MoneyField label={t('Amount')} cents={entry.cents} onChange={(cents) => onChange({ ...entry, cents })} />
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>{t('Which day of the month?')}</Text>
        <DayPicker day={entry.day} onChange={(d) => onChange({ ...entry, day: d })} />
      </View>
    </View>
  );
}

type Step =
  | { kind: 'prefs' }
  | { kind: 'salary' }
  | { kind: 'income' }
  | { kind: 'bills' }
  | { kind: 'amount'; preset: Preset; type: 'income' | 'expense'; card?: boolean }
  | { kind: 'cardAsk' }
  | { kind: 'cardInfo' }
  | { kind: 'cardInvoice' }
  | { kind: 'cardFixed' }
  | { kind: 'cardInstall' }
  | { kind: 'cardTotal' }
  | { kind: 'review' };

/**
 * First-access setup, one decision per screen: the salary, other income, the fixed bills (picked on tiles) and,
 * for each one picked, its amount and day. Everything becomes a fixed transaction from this month on, pending
 * until the person confirms it, so the app starts filled in.
 */
export function Onboarding({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const c = useColors();
  const { addTransaction, saveCard, data } = useStore();
  const { keep } = usePrefs();
  const [i, setI] = useState(0);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [salaryOn, setSalaryOn] = useState(true);
  const [incomePicked, setIncomePicked] = useState<string[]>([]);
  const [billsPicked, setBillsPicked] = useState<string[]>([]);
  const [customIncome, setCustomIncome] = useState<Preset[]>([]);
  const [customBills, setCustomBills] = useState<Preset[]>([]);
  // credit card (one, in the setup; more later): its data, the invoice we are talking about and what it holds
  const [hasCard, setHasCard] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardLimit, setCardLimit] = useState(0);
  const [cardDue, setCardDue] = useState(10);
  const [invoiceKey, setInvoiceKey] = useState<string | null>(null);
  const [cardFixedPicked, setCardFixedPicked] = useState<string[]>([]);
  const [customCardFixed, setCustomCardFixed] = useState<Preset[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [draft, setDraft] = useState({ label: '', value: 0, left: '' });
  const [invoiceTotal, setInvoiceTotal] = useState(0);

  const incomeItems = [...OTHER_INCOME, ...customIncome];
  const billItems = [...BILLS, ...customBills];
  const cardFixedItems = [...CARD_FIXED, ...customCardFixed];
  /** the invoice we are talking about (due month, YYYY-MM): by default the one open today */
  const invKey = invoiceKey ?? openInvoiceKey({ dueDay: cardDue } as never, todayISO());
  const entryOf = (p: Preset): Entry => entries[p.id] ?? { cents: 0, day: p.day };

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [{ kind: 'prefs' }, { kind: 'salary' }];
    if (salaryOn) list.push({ kind: 'amount', preset: SALARY, type: 'income' });
    list.push({ kind: 'income' });
    for (const p of [...OTHER_INCOME, ...customIncome]) if (incomePicked.includes(p.id)) list.push({ kind: 'amount', preset: p, type: 'income' });
    list.push({ kind: 'bills' });
    for (const p of [...BILLS, ...customBills]) if (billsPicked.includes(p.id)) list.push({ kind: 'amount', preset: p, type: 'expense' });
    list.push({ kind: 'cardAsk' });
    if (hasCard) {
      list.push({ kind: 'cardInfo' }, { kind: 'cardInvoice' }, { kind: 'cardFixed' });
      for (const p of [...CARD_FIXED, ...customCardFixed]) if (cardFixedPicked.includes(p.id)) list.push({ kind: 'amount', preset: p, type: 'expense', card: true });
      list.push({ kind: 'cardInstall' }, { kind: 'cardTotal' });
    }
    list.push({ kind: 'review' });
    return list;
  }, [salaryOn, incomePicked, billsPicked, customIncome, customBills, hasCard, cardFixedPicked, customCardFixed]);

  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  /** everything that will be created */
  const picked = useMemo(() => {
    const out: { type: 'income' | 'expense'; preset: Preset; entry: Entry }[] = [];
    for (const st of steps) if (st.kind === 'amount' && !st.card) {
      const e = entries[st.preset.id] ?? { cents: 0, day: st.preset.day };
      if (e.cents > 0) out.push({ type: st.type, preset: st.preset, entry: e });
    }
    return out;
  }, [steps, entries]);
  const income = picked.filter((x) => x.type === 'income').reduce((sum, x) => sum + x.entry.cents, 0);
  const bills = picked.filter((x) => x.type === 'expense').reduce((sum, x) => sum + x.entry.cents, 0);
  const left = income - bills;

  /** what the card items already add up to on the invoice, and the difference to what the person says it is */
  const cardFixed = steps.flatMap((st) => (st.kind === 'amount' && st.card && (entries[st.preset.id]?.cents ?? 0) > 0 ? [{ preset: st.preset, entry: entries[st.preset.id] }] : []));
  const knownOnInvoice = cardFixed.reduce((sum, x) => sum + x.entry.cents, 0) + installments.reduce((sum, x) => sum + x.value, 0);
  const adjustment = invoiceTotal - knownOnInvoice;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const addCustom = (label: string, kind: 'income' | 'expense') => {
    const id = `c-${kind}-${label}-${Date.now()}`;
    const p: Preset = { id, label, icon: 'plus-circle', category: kind === 'expense' ? 'other' : undefined, day: kind === 'expense' ? 10 : 5, custom: true };
    if (kind === 'income') {
      setCustomIncome((l) => [...l, p]);
      setIncomePicked((l) => [...l, id]);
    } else {
      setCustomBills((l) => [...l, p]);
      setBillsPicked((l) => [...l, id]);
    }
  };

  const addCustomCard = (label: string) => {
    const id = `cf-c-${label}-${Date.now()}`;
    setCustomCardFixed((l) => [...l, { id, label, icon: 'plus-circle', category: 'subscriptions', day: 10, custom: true }]);
    setCardFixedPicked((l) => [...l, id]);
  };
  const addInstallment = () => {
    const left = Number(draft.left);
    if (!draft.label.trim() || draft.value <= 0 || !(left >= 1)) return;
    setInstallments((l) => [...l, { id: `i-${Date.now()}`, label: draft.label.trim(), value: draft.value, left: Math.min(left, 99) }]);
    setDraft({ label: '', value: 0, left: '' });
  };

  /** the language and currency on screen are the account's from here on (the suggestion of a new account, or the person's pick) */
  const keepPrefs = () => {
    keep().catch(() => {});
  };

  const finish = () => {
    keepPrefs();
    const { y, m } = parseISO(todayISO());
    const today = todayISO();
    if (hasCard && cardName.trim()) {
      const cardId = saveCard({ name: cardName.trim(), limit: cardLimit, dueDay: cardDue, color: CARD_COLORS.find((x) => !data.cards.some((cd) => cd.color === x.value))?.value ?? CARD_COLORS[0].value });
      const onCard = { cardId, invoiceKey: invKey, date: today, confirmed: false };
      for (const x of cardFixed) {
        addTransaction({ ...onCard, type: 'expense', description: labelOf(x.preset), amount: x.entry.cents, fixed: true, category: x.preset.category, installments: 1 });
      }
      for (const x of installments) {
        addTransaction({ ...onCard, type: 'expense', description: x.label, amount: x.value * x.left, fixed: false, category: 'other', installments: x.left });
      }
      // the rest of the invoice: what the person has not told us one by one (more) or what overshoots (less, as a refund)
      if (adjustment > 0) addTransaction({ ...onCard, type: 'expense', description: t('Other purchases'), amount: adjustment, fixed: false, category: 'other', installments: 1 });
      if (adjustment < 0) addTransaction({ ...onCard, type: 'income', description: t('Invoice adjustment'), amount: -adjustment, fixed: false, category: 'refund', installments: 1 });
    }
    for (const x of picked) {
      addTransaction({
        type: x.type,
        description: labelOf(x.preset),
        amount: x.entry.cents,
        date: toISO(y, m, Math.min(x.entry.day, daysInMonth(y, m))),
        confirmed: false,
        fixed: true,
        category: x.preset.category,
        installments: 1,
      });
    }
    onDone();
  };

  /** the current amount screen has what it needs */
  const needsAmount =
    (step.kind === 'amount' && entryOf(step.preset).cents <= 0) ||
    (step.kind === 'cardInfo' && (!cardName.trim() || cardLimit <= 0)) ||
    (step.kind === 'cardTotal' && invoiceTotal <= 0);
  const next = () => {
    if (step.kind === 'prefs') keepPrefs();
    setI((n) => Math.min(n + 1, steps.length - 1));
  };
  const back = () => setI((n) => Math.max(n - 1, 0));

  const body = (() => {
    switch (step.kind) {
      case 'prefs':
        return (
          <Screen icon="globe" title={t('Language and currency')} hint={t('We picked these from your device and location. Change them if they are not right.')}>
            <PrefsFields save={false} />
          </Screen>
        );
      case 'salary':
        return (
          <Screen icon="briefcase" title={t('Do you receive a salary?')} hint={t('A fixed income, paid every month. You can add other income next.')}>
            <View style={{ gap: spacing.md }}>
              <Button label={t('Yes, I do')} icon="check" onPress={() => { setSalaryOn(true); setI(i + 1); }} />
              <Button label={t('No fixed salary')} variant="secondary" onPress={() => { setSalaryOn(false); setI(i + 1); }} />
            </View>
          </Screen>
        );
      case 'income':
        return (
          <Screen icon="trending-up" title={t('Any other income?')} hint={t('Tap what applies, or just continue.')}>
            <Tiles items={incomeItems} picked={incomePicked} onToggle={(id) => toggle(incomePicked, setIncomePicked, id)} onAdd={(l) => addCustom(l, 'income')} />
          </Screen>
        );
      case 'bills':
        return (
          <Screen icon="calendar" title={t('What do you pay every month?')} hint={t('Tap everything that applies. We ask the amounts next, one by one.')}>
            <Tiles items={billItems} picked={billsPicked} onToggle={(id) => toggle(billsPicked, setBillsPicked, id)} onAdd={(l) => addCustom(l, 'expense')} />
          </Screen>
        );
      case 'amount':
        return (
          <Screen
            icon={step.preset.icon}
            title={step.preset.id === 'salary' ? t('How much is your salary?') : t('How much is “{name}”?', { name: labelOf(step.preset) })}
            hint={t('Your usual amount is fine, you can change it any month.')}
          >
            <AmountAnswer entry={entryOf(step.preset)} onChange={(e) => setEntries((m) => ({ ...m, [step.preset.id]: e }))} />
          </Screen>
        );
      case 'cardAsk':
        return (
          <Screen icon="credit-card" title={t('Do you use a credit card?')} hint={t('We can set up your current invoice too, so you do not have to add it purchase by purchase.')}>
            <View style={{ gap: spacing.md }}>
              <Button label={t('Yes, I do')} icon="check" onPress={() => { setHasCard(true); setI(i + 1); }} />
              <Button label={t('No card')} variant="secondary" onPress={() => { setHasCard(false); setI(i + 1); }} />
            </View>
          </Screen>
        );
      case 'cardInfo':
        return (
          <Screen icon="credit-card" title={t('Tell us about the card')}>
            <View style={{ gap: spacing.lg }}>
              <TextField label={t('Card name')} value={cardName} onChangeText={setCardName} placeholder={t('e.g. Main card')} maxLength={40} />
              <MoneyField label={t('Limit')} cents={cardLimit} onChange={setCardLimit} />
              <View style={{ gap: spacing.sm }}>
                <Text style={[type.label, { color: c.text }]}>{t('Which day does the invoice fall due?')}</Text>
                <DayPicker day={cardDue} onChange={setCardDue} />
              </View>
            </View>
          </Screen>
        );
      case 'cardInvoice': {
        const open = openInvoiceKey({ dueDay: cardDue } as never, todayISO());
        const options = [addMonthsToKey(open, -1), open, addMonthsToKey(open, 1)];
        return (
          <Screen icon="calendar" title={t('Which invoice are we filling in?')} hint={t('The one you see in your bank app now. Pick the month it falls due, on day {day}.', { day: cardDue })}>
            <View style={{ gap: spacing.md }}>
              {options.map((k) => {
                const on = k === invKey;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setInvoiceKey(k)}
                    style={[s.option, { borderColor: on ? c.primary : 'transparent', backgroundColor: on ? 'rgba(45,85,217,0.08)' : c.surface }, Platform.OS === 'web' && ({ cursor: 'pointer' } as object)]}
                  >
                    <Text style={[type.label, { color: c.text, flex: 1 }]}>{monthLabel(k)}</Text>
                    {k === open && <Text style={[type.body, { color: c.textMuted }]}>{t('Open now')}</Text>}
                    <Feather name={on ? 'check-circle' : 'circle'} size={22} color={on ? c.primary : c.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </Screen>
        );
      }
      case 'cardFixed':
        return (
          <Screen icon="repeat" title={t('Any fixed charges on this card?')} hint={t('Subscriptions and bills that repeat every month. We ask the amounts next.')}>
            <Tiles items={cardFixedItems} picked={cardFixedPicked} onToggle={(id) => toggle(cardFixedPicked, setCardFixedPicked, id)} onAdd={addCustomCard} />
          </Screen>
        );
      case 'cardInstall':
        return (
          <Screen icon="layers" title={t('Anything in installments?')} hint={t('Add each purchase you are still paying off, counting the installment on the current invoice. Or just continue.')}>
            <View style={{ gap: spacing.lg }}>
              {installments.map((x) => (
                <View key={x.id} style={[s.option, { backgroundColor: c.surface, borderColor: 'transparent' }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{x.label}</Text>
                    <Text style={[type.body, { color: c.textMuted }]}>{t('{amount} × {count} left', { amount: formatMoney(x.value), count: x.left })}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Remove {name}', { name: x.label })} onPress={() => setInstallments((l) => l.filter((y) => y.id !== x.id))} style={s.remove}>
                    <Feather name="x" size={20} color={c.textMuted} />
                  </Pressable>
                </View>
              ))}
              <TextField label={t('What was it?')} value={draft.label} onChangeText={(label) => setDraft((d) => ({ ...d, label }))} placeholder={t('e.g. Phone')} maxLength={40} />
              <MoneyField label={t('Installment value')} cents={draft.value} onChange={(value) => setDraft((d) => ({ ...d, value }))} />
              <TextField label={t('Installments left')} value={draft.left} onChangeText={(t) => setDraft((d) => ({ ...d, left: t.replace(/\D/g, '') }))} keyboardType="number-pad" inputMode="numeric" maxLength={2} placeholder={t('e.g. 6')} />
              <Button label={t('Add this installment')} icon="plus" variant="secondary" onPress={addInstallment} disabled={!draft.label.trim() || draft.value <= 0 || !(Number(draft.left) >= 1)} />
            </View>
          </Screen>
        );
      case 'cardTotal':
        return (
          <Screen icon="file-text" title={t('How much is the invoice?')} hint={t('The total of the invoice due in {month}, as your bank shows it.', { month: monthLabel(invKey) })}>
            <View style={{ gap: spacing.lg }}>
              <MoneyField label={t('Invoice total')} cents={invoiceTotal} onChange={setInvoiceTotal} />
              {knownOnInvoice > 0 && (
                <View style={[s.summary, { backgroundColor: c.surface }]}>
                  <View style={s.sumRow}>
                    <Text style={[type.body, { color: c.textMuted }]}>{t('Fixed and installments you added')}</Text>
                    <Text style={[type.label, { color: c.text }]}>{formatMoney(knownOnInvoice)}</Text>
                  </View>
                  {invoiceTotal > 0 && (
                    <View style={s.sumRow}>
                      <Text style={[type.body, { color: c.textMuted, flex: 1 }]}>{adjustment >= 0 ? t('Added as other purchases') : t('Adjusted down (an installment may start later)')}</Text>
                      <Text style={[type.label, { color: adjustment >= 0 ? c.expense : c.income }]}>{adjustment >= 0 ? '+' : '-'}{formatMoney(Math.abs(adjustment))}</Text>
                    </View>
                  )}
                </View>
              )}
              {knownOnInvoice > 0 && <Button label={t('Use only what I added')} variant="tertiary" onPress={() => setInvoiceTotal(knownOnInvoice)} />}
            </View>
          </Screen>
        );
      case 'review':
        return (
          <Screen icon="check-circle" title={picked.length || hasCard ? t('Your month is ready') : t('All set')} hint={picked.length || hasCard ? t('Everything is added as pending, until you confirm it.') : t('You can add everything later with the + button.')}>
            {(picked.length > 0 || hasCard) && (
              <View style={[s.summary, { backgroundColor: c.surface }]}>
                <View style={s.sumRow}>
                  <Text style={[type.body, { color: c.textMuted }]}>{t('Income')}</Text>
                  <Text style={[type.label, { color: c.income }]}>{formatMoney(income)}</Text>
                </View>
                <View style={s.sumRow}>
                  <Text style={[type.body, { color: c.textMuted }]}>{t('Fixed bills')}</Text>
                  <Text style={[type.label, { color: c.expense }]}>{formatMoney(bills)}</Text>
                </View>
                {hasCard && (
                  <View style={s.sumRow}>
                    <Text style={[type.body, { color: c.textMuted }]}>{t('{card} invoice ({month})', { card: cardName.trim() || t('Card'), month: monthLabel(invKey) })}</Text>
                    <Text style={[type.label, { color: c.expense }]}>{formatMoney(invoiceTotal)}</Text>
                  </View>
                )}
                <View style={[s.sumRow, s.sumTotal, { borderTopColor: c.border }]}>
                  <Text style={[type.label, { color: c.text }]}>{left >= 0 ? t('Left over') : t('To grow')}</Text>
                  <Text style={[type.title, { color: left >= 0 ? c.primary : c.expense }]}>{formatMoney(Math.abs(left))}</Text>
                </View>
              </View>
            )}
          </Screen>
        );
    }
  })();

  // the yes/no screens answer with their own two buttons: no footer there
  const footer = step.kind === 'salary' || step.kind === 'cardAsk' ? undefined : (
    <View style={s.footer}>
      <Button label={t('Back')} icon="arrow-left" variant="secondary" onPress={back} disabled={i === 0} flex />
      <Button label={last ? (picked.length || hasCard ? t('Start') : t('Done')) : t('Continue')} icon={last ? 'check' : 'arrow-right'} iconRight onPress={last ? finish : next} disabled={needsAmount} flex />
    </View>
  );

  return (
    <Sheet visible={visible} title={t('Quick setup')} onClose={() => { keepPrefs(); onClose(); }} footer={footer}>
      <View style={{ gap: spacing.lg }}>
        <View style={[s.track, { backgroundColor: c.surface }]}>
          <View style={[s.fill, { backgroundColor: c.primary, width: `${((Math.min(i, steps.length - 1) + 1) / steps.length) * 100}%` }]} />
        </View>
        {body}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
  screen: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.md },
  badge: { width: 72, height: 72, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  question: { textAlign: 'center', fontSize: 24, lineHeight: 30 },
  hint: { textAlign: 'center', maxWidth: 420 },
  answer: { width: '100%', marginTop: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  tile: { minHeight: 92, borderRadius: radius.control, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, borderRadius: radius.control, borderWidth: 2, paddingHorizontal: spacing.lg },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  days: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.xs, borderRadius: radius.control },
  dayCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  day: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  footer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summary: { borderRadius: radius.control, padding: spacing.lg, gap: spacing.md },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sumTotal: { borderTopWidth: 1, paddingTop: spacing.md },
});
