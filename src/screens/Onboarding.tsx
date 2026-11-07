import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '../components/Button';
import { MoneyField, TextField } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { daysInMonth, parseISO, toISO, todayISO } from '../domain/dates';
import { formatMoney } from '../domain/money';
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
}

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
  { id: 'spotify', label: 'Spotify', icon: 'music', category: 'subscriptions', day: 10 },
  { id: 'netflix', label: 'Netflix', icon: 'tv', category: 'subscriptions', day: 10 },
  { id: 'youtube', label: 'YouTube Premium', icon: 'play-circle', category: 'subscriptions', day: 10 },
];

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
              accessibilityLabel={p.label}
              onPress={() => onToggle(p.id)}
              style={[
                s.tile,
                { width: `${100 / cols - 2}%` as `${number}%`, borderColor: on ? c.primary : 'transparent', backgroundColor: on ? 'rgba(45,85,217,0.08)' : c.surface },
                Platform.OS === 'web' && ({ transitionProperty: 'background-color, border-color', transitionDuration: '140ms', cursor: 'pointer' } as object),
              ]}
            >
              <Feather name={on ? 'check-circle' : p.icon} size={24} color={on ? c.primary : c.textMuted} />
              <Text style={[type.body, { color: c.text, fontWeight: on ? '600' : '400', textAlign: 'center' }]} numberOfLines={2}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.addRow}>
        <View style={{ flex: 1 }}>
          <TextField label="Something else?" value={name} onChangeText={setName} placeholder="Type a name" maxLength={40} onSubmitEditing={add} returnKeyType="done" />
        </View>
        <Button label="Add" icon="plus" variant="secondary" onPress={add} disabled={!name.trim()} />
      </View>
    </View>
  );
}

/** Amount and day, on one screen. */
function AmountAnswer({ entry, onChange }: { entry: Entry; onChange: (e: Entry) => void }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.xl }}>
      <MoneyField label="Amount" cents={entry.cents} onChange={(cents) => onChange({ ...entry, cents })} />
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Which day of the month?</Text>
        {/* calendar style: 1 to 31 in rows of seven, no weekdays */}
        <View style={s.days}>
          {Array.from({ length: 31 }, (_, k) => k + 1).map((d) => {
            const on = d === entry.day;
            return (
              <View key={d} style={s.dayCell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Day ${d}`}
                  onPress={() => onChange({ ...entry, day: d })}
                  style={[s.day, { backgroundColor: on ? c.primary : 'transparent' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as object)]}
                >
                  <Text style={[type.label, { color: on ? '#FFFFFF' : c.text }]}>{d}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

type Step =
  | { kind: 'salary' }
  | { kind: 'income' }
  | { kind: 'bills' }
  | { kind: 'amount'; preset: Preset; type: 'income' | 'expense' }
  | { kind: 'review' };

/**
 * First-access setup, one decision per screen: the salary, other income, the fixed bills (picked on tiles) and,
 * for each one picked, its amount and day. Everything becomes a fixed transaction from this month on, pending
 * until the person confirms it, so the app starts filled in.
 */
export function Onboarding({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const c = useColors();
  const { addTransaction } = useStore();
  const [i, setI] = useState(0);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [salaryOn, setSalaryOn] = useState(true);
  const [incomePicked, setIncomePicked] = useState<string[]>([]);
  const [billsPicked, setBillsPicked] = useState<string[]>([]);
  const [customIncome, setCustomIncome] = useState<Preset[]>([]);
  const [customBills, setCustomBills] = useState<Preset[]>([]);

  const incomeItems = [...OTHER_INCOME, ...customIncome];
  const billItems = [...BILLS, ...customBills];
  const entryOf = (p: Preset): Entry => entries[p.id] ?? { cents: 0, day: p.day };

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [{ kind: 'salary' }];
    if (salaryOn) list.push({ kind: 'amount', preset: SALARY, type: 'income' });
    list.push({ kind: 'income' });
    for (const p of [...OTHER_INCOME, ...customIncome]) if (incomePicked.includes(p.id)) list.push({ kind: 'amount', preset: p, type: 'income' });
    list.push({ kind: 'bills' });
    for (const p of [...BILLS, ...customBills]) if (billsPicked.includes(p.id)) list.push({ kind: 'amount', preset: p, type: 'expense' });
    list.push({ kind: 'review' });
    return list;
  }, [salaryOn, incomePicked, billsPicked, customIncome, customBills]);

  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  /** everything that will be created */
  const picked = useMemo(() => {
    const out: { type: 'income' | 'expense'; preset: Preset; entry: Entry }[] = [];
    for (const st of steps) if (st.kind === 'amount') {
      const e = entries[st.preset.id] ?? { cents: 0, day: st.preset.day };
      if (e.cents > 0) out.push({ type: st.type, preset: st.preset, entry: e });
    }
    return out;
  }, [steps, entries]);
  const income = picked.filter((x) => x.type === 'income').reduce((sum, x) => sum + x.entry.cents, 0);
  const bills = picked.filter((x) => x.type === 'expense').reduce((sum, x) => sum + x.entry.cents, 0);
  const left = income - bills;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const addCustom = (label: string, kind: 'income' | 'expense') => {
    const id = `c-${kind}-${label}-${Date.now()}`;
    const p: Preset = { id, label, icon: 'plus-circle', category: kind === 'expense' ? 'other' : undefined, day: kind === 'expense' ? 10 : 5 };
    if (kind === 'income') {
      setCustomIncome((l) => [...l, p]);
      setIncomePicked((l) => [...l, id]);
    } else {
      setCustomBills((l) => [...l, p]);
      setBillsPicked((l) => [...l, id]);
    }
  };

  const finish = () => {
    const { y, m } = parseISO(todayISO());
    for (const x of picked) {
      addTransaction({
        type: x.type,
        description: x.preset.label,
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
  const needsAmount = step.kind === 'amount' && entryOf(step.preset).cents <= 0;
  const next = () => setI((n) => Math.min(n + 1, steps.length - 1));
  const back = () => setI((n) => Math.max(n - 1, 0));

  const body = (() => {
    switch (step.kind) {
      case 'salary':
        return (
          <Screen icon="briefcase" title="Do you receive a salary?" hint="A fixed income, paid every month. You can add other income next.">
            <View style={{ gap: spacing.md }}>
              <Button label="Yes, I do" icon="check" onPress={() => { setSalaryOn(true); setI(1); }} />
              <Button label="No fixed salary" variant="secondary" onPress={() => { setSalaryOn(false); setI(1); }} />
            </View>
          </Screen>
        );
      case 'income':
        return (
          <Screen icon="trending-up" title="Any other income?" hint="Tap what applies, or just continue.">
            <Tiles items={incomeItems} picked={incomePicked} onToggle={(id) => toggle(incomePicked, setIncomePicked, id)} onAdd={(l) => addCustom(l, 'income')} />
          </Screen>
        );
      case 'bills':
        return (
          <Screen icon="calendar" title="What do you pay every month?" hint="Tap everything that applies. We ask the amounts next, one by one.">
            <Tiles items={billItems} picked={billsPicked} onToggle={(id) => toggle(billsPicked, setBillsPicked, id)} onAdd={(l) => addCustom(l, 'expense')} />
          </Screen>
        );
      case 'amount':
        return (
          <Screen
            icon={step.preset.icon}
            title={step.type === 'income' ? `How much is your ${step.preset.label.toLowerCase()}?` : `How much is ${step.preset.label.toLowerCase()}?`}
            hint="Your usual amount is fine, you can change it any month."
          >
            <AmountAnswer entry={entryOf(step.preset)} onChange={(e) => setEntries((m) => ({ ...m, [step.preset.id]: e }))} />
          </Screen>
        );
      case 'review':
        return (
          <Screen icon="check-circle" title={picked.length ? 'Your month is ready' : 'All set'} hint={picked.length ? `${picked.length} ${picked.length === 1 ? 'item' : 'items'} will be added, pending until you confirm them.` : 'You can add everything later with the + button.'}>
            {picked.length > 0 && (
              <View style={[s.summary, { backgroundColor: c.surface }]}>
                <View style={s.sumRow}>
                  <Text style={[type.body, { color: c.textMuted }]}>Income</Text>
                  <Text style={[type.label, { color: c.income }]}>{formatMoney(income)}</Text>
                </View>
                <View style={s.sumRow}>
                  <Text style={[type.body, { color: c.textMuted }]}>Fixed bills</Text>
                  <Text style={[type.label, { color: c.expense }]}>{formatMoney(bills)}</Text>
                </View>
                <View style={[s.sumRow, s.sumTotal, { borderTopColor: c.border }]}>
                  <Text style={[type.label, { color: c.text }]}>{left >= 0 ? 'Left over' : 'Short'}</Text>
                  <Text style={[type.title, { color: left >= 0 ? c.primary : c.expense }]}>{formatMoney(Math.abs(left))}</Text>
                </View>
              </View>
            )}
          </Screen>
        );
    }
  })();

  // the first screen answers with its own two buttons: no footer there
  const footer = step.kind === 'salary' ? undefined : (
    <View style={s.footer}>
      <Button label="Back" icon="arrow-left" variant="secondary" onPress={back} flex />
      <Button label={last ? (picked.length ? 'Start' : 'Done') : 'Continue'} icon={last ? 'check' : 'arrow-right'} iconRight onPress={last ? finish : next} disabled={needsAmount} flex />
    </View>
  );

  return (
    <Sheet visible={visible} title="Quick setup" onClose={onClose} footer={footer}>
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
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  days: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.xs, borderRadius: radius.control },
  dayCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  day: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summary: { borderRadius: radius.control, padding: spacing.lg, gap: spacing.md },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sumTotal: { borderTopWidth: 1, paddingTop: spacing.md },
});
