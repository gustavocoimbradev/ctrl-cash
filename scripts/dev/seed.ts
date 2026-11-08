// Fills the LOCAL development stack with a demo account, so the app can be tried (and photographed) without any
// real data:   make up:dev   (it runs this for you)
//   email: demo@ctrlcash.dev    password: demo1234
// It creates the account in the Firebase Auth EMULATOR, signs in there for a token, and sends the demo documents to the
// local API (PUT /api/data), so they land in the local PostgreSQL. It refuses to run without the emulator.
import { openInvoiceKey } from '../../src/domain/cards';
import { addMonthsToKey, currentMonthKey, daysInMonth, todayISO, toISO } from '../../src/domain/dates';
import { NewTransactionInput, createTransactions } from '../../src/domain/transactions';
import { buildSummary } from '../../src/domain/summary';
import { CategoryRecord, CreditCard, InvoicePayment, Transaction } from '../../src/types';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!AUTH_HOST) {
  console.error('Refusing to run: FIREBASE_AUTH_EMULATOR_HOST is not set (this only seeds the local emulator and API).');
  process.exit(1);
}
const API_URL = (process.env.API_URL ?? 'http://localhost:3300/api').replace(/\/$/, '');

const EMAIL = 'demo@ctrlcash.dev';
const PASSWORD = 'demo1234';

const today = todayISO();
const thisMonth = currentMonthKey();
/** date `offset` months from now, on `day` (clamped to the month length) */
const on = (offset: number, day: number) => {
  const [y, m] = addMonthsToKey(thisMonth, offset).split('-').map(Number);
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
};

let order = 0;
const stamp = <T extends { createdAt?: number }>(item: T): T => ({ ...item, createdAt: 1_700_000_000_000 + order++ });

const txs: Transaction[] = [];
const add = (input: Omit<NewTransactionInput, 'installments'> & { installments?: number }) => {
  for (const t of createTransactions({ installments: 1, ...input })) txs.push(stamp(t));
};
/** months a fixed item was already confirmed in: from its start month up to today's month (if its day has come) */
const confirmedUpTo = (startOffset: number, day: number) => {
  const months: string[] = [];
  for (let k = startOffset; k <= 0; k++) if (k < 0 || today >= on(0, day)) months.push(addMonthsToKey(thisMonth, k));
  return months;
};
const fixed = (type: 'income' | 'expense', description: string, amount: number, day: number, category: string, startOffset = -8) => {
  const [t] = createTransactions({ type, description, amount, date: on(startOffset, day), confirmed: true, fixed: true, category, installments: 1 });
  txs.push(stamp({ ...t, confirmedMonths: confirmedUpTo(startOffset, day) }));
};

// ---- income and fixed bills
fixed('income', 'Salary', 850000, 5, 'salary');
fixed('expense', 'Rent', 180000, 10, 'bills');
fixed('expense', 'Health plan', 38000, 8, 'health');
fixed('expense', 'Internet', 12990, 14, 'bills');
fixed('expense', 'Gym', 12900, 20, 'personal_care');
fixed('expense', 'Streaming bundle', 5590, 22, 'subscriptions');
add({ type: 'income', description: 'Freelance project', amount: 140000, date: on(-1, 18), confirmed: true, fixed: false, category: 'freelance' });
add({ type: 'income', description: 'Freelance project', amount: 90000, date: on(0, 26), confirmed: false, fixed: false, category: 'freelance' });

// ---- one-off spending of the last months (paid from the account)
const spend = (offset: number, day: number, description: string, amount: number, category: string, confirmed = true) =>
  add({ type: 'expense', description, amount, date: on(offset, day), confirmed, fixed: false, category });
for (const [offset, a, b, c] of [[-3, 21490, 18730, 25600], [-2, 19870, 23110, 21040], [-1, 22650, 20380, 24990]] as const) {
  spend(offset, 4, 'Supermarket', a, 'groceries');
  spend(offset, 13, 'Supermarket', b, 'groceries');
  spend(offset, 24, 'Supermarket', c, 'groceries');
  spend(offset, 7, 'Coffee with friends', 1850, 'coffee');
  spend(offset, 16, 'Coffee with friends', 2240, 'coffee');
  spend(offset, 19, 'Fuel', 24000, 'car');
}
spend(-1, 9, 'Dinner out', 7840, 'leisure');
spend(-1, 21, 'Pharmacy', 5390, 'health');
spend(-2, 12, 'Birthday gift', 12000, 'gifts');
spend(-1, 25, 'Online course', 29900, 'education');
spend(-3, 15, 'Vehicle tax', 45000, 'taxes');
spend(0, 3, 'Supermarket', 20840, 'groceries', today >= on(0, 3));
spend(0, 11, 'Fuel', 24000, 'car', today >= on(0, 11));
spend(0, 8, 'Coffee with friends', 1950, 'coffee', today >= on(0, 8));
spend(0, 27, 'Dentist', 18000, 'health', false);
spend(0, 29, 'Supermarket', 23000, 'groceries', false);

// ---- cards: purchases, installments and the invoices already paid
const cardA: CreditCard = { id: 'card-everyday', name: 'Everyday card', limit: 900000, dueDay: 12, color: '#8B3FD9', createdAt: 1_700_000_000_000 };
const cardB: CreditCard = { id: 'card-travel', name: 'Travel card', limit: 500000, dueDay: 20, color: '#2F80ED', createdAt: 1_700_000_000_001 };
const buy = (card: CreditCard, offset: number, day: number, description: string, amount: number, category: string, installments = 1) => {
  const date = on(offset, day);
  add({ type: 'expense', description, amount, date, confirmed: true, fixed: false, cardId: card.id, invoiceKey: openInvoiceKey(card, date), category, installments });
};
buy(cardA, -2, 6, 'Laptop', 270000, 'investments', 6);
buy(cardA, -1, 9, 'Sneakers', 45000, 'personal_care', 3);
buy(cardA, -1, 20, 'Pet food', 8900, 'pets');
buy(cardA, -1, 26, 'Restaurant', 9650, 'leisure');
buy(cardA, 0, 2, 'Streaming gift card', 6000, 'subscriptions');
buy(cardA, 0, 6, 'Pet vet', 21000, 'pets');
buy(cardB, 0, 1, 'Flights', 160000, 'leisure', 2);
buy(cardB, -1, 14, 'Hotel', 88000, 'leisure');

// stable ids (and installment groups): running the seed again replaces these documents instead of adding copies
const groups = new Map<string, string>();
txs.forEach((t, i) => {
  t.id = `demo-tx-${String(i).padStart(3, '0')}`;
  if (t.installment) {
    if (!groups.has(t.installment.groupId)) groups.set(t.installment.groupId, `demo-group-${groups.size + 1}`);
    t.installment = { ...t.installment, groupId: groups.get(t.installment.groupId)! };
  }
});

// invoices of the past months are already paid: one payment per invoice, on its due day
const payments: InvoicePayment[] = [];
for (const card of [cardA, cardB]) {
  for (const key of [addMonthsToKey(thisMonth, -2), addMonthsToKey(thisMonth, -1)]) {
    const amount = txs.filter((t) => t.cardId === card.id && t.invoiceKey === key).reduce((s, t) => s + t.amount, 0);
    const [y, m] = key.split('-').map(Number);
    if (amount > 0) payments.push({ id: `pay-${card.id}-${key}`, cardId: card.id, invoiceKey: key, amount, date: toISO(y, m, Math.min(card.dueDay, daysInMonth(y, m))) });
  }
}

// one custom category, to show the feature
const categories: CategoryRecord[] = [{ id: 'coffee', slug: 'coffee', kind: 'expense', name: 'Coffee shops', weight: 0.45, createdAt: 1_700_000_000_000 }];

/** Signs in to the Auth emulator (creating the demo account the first time) and returns the ID token. */
async function tokenFor(email: string): Promise<string> {
  const base = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts`;
  const body = JSON.stringify({ email, password: PASSWORD, returnSecureToken: true });
  const headers = { 'Content-Type': 'application/json' };
  let res = await fetch(`${base}:signUp?key=demo`, { method: 'POST', headers, body });
  if (!res.ok) res = await fetch(`${base}:signInWithPassword?key=demo`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Auth emulator answered ${res.status}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

const demoToken = () => tokenFor(EMAIL);

/** One call to the local API as somebody. */
async function api<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** The social side: two accounts that follow each other, a short chat and a summary shared both ways. */
async function seedSocial(demo: string, data: Parameters<typeof buildSummary>[0]) {
  const maria = await tokenFor('maria@ctrlcash.dev');
  await api(demo, '/profile', 'PUT', { handle: 'demo', displayName: 'Demo', bio: 'Trying to keep more than I spend.', color: '#2D55D9' });
  await api(maria, '/profile', 'PUT', { handle: 'maria', displayName: 'Maria Costa', bio: 'Saving for a trip, one month at a time.', color: '#8B5CF6' });
  await api(demo, '/follow', 'POST', { handle: 'maria' });
  await api(maria, '/follow', 'POST', { handle: 'demo' });
  await api(demo, '/shares', 'POST', { handle: 'maria' });
  await api(maria, '/shares', 'POST', { handle: 'demo' });
  await api(demo, '/summary', 'PUT', buildSummary(data));
  // Maria's summary, handmade: a steady salary, a few months of savings and one tight month
  const current = currentMonthKey();
  const left = [140000, 95000, 120000, -18000, 160000, 110000, 90000, 130000, 70000, 150000, 125000, 105000];
  const months = left.map((l, i) => ({ key: addMonthsToKey(current, i - 11), income: 520000, expense: 520000 - l, left: l }));
  await api(maria, '/summary', 'PUT', {
    version: 1,
    generatedAt: Date.now(),
    months,
    categories: [
      { slug: 'bills', label: 'Bills', amount: 1_720_000 },
      { slug: 'groceries', label: 'Groceries', amount: 1_050_000 },
      { slug: 'leisure', label: 'Leisure', amount: 610_000 },
      { slug: 'car', label: 'Car', amount: 480_000 },
      { slug: 'health', label: 'Health', amount: 330_000 },
      { slug: 'subscriptions', label: 'Subscriptions', amount: 160_000 },
    ],
  });
  // a short chat, only the first time
  const thread = await api<{ messages: unknown[] }>(demo, '/messages/maria');
  if (thread.messages.length === 0) {
    await api(maria, '/messages', 'POST', { to: 'demo', body: 'Hey! I just shared my monthly summary with you.' });
    await api(demo, '/messages', 'POST', { to: 'maria', body: 'Nice, thanks! Mine is on my profile too.' });
    await api(maria, '/messages', 'POST', { to: 'demo', body: 'How is the saving going this month?' });
  }
}

async function main() {
  const token = await demoToken();
  const res = await fetch(`${API_URL}/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ transactions: txs, cards: [cardA, cardB], payments, categories }),
  });
  if (!res.ok) throw new Error(`The API answered ${res.status}: ${await res.text()}`);
  await seedSocial(token, { transactions: txs, cards: [cardA, cardB], payments, categories, reserves: [], reserveMoves: [] });
  console.log(`Demo account ready: ${EMAIL} / ${PASSWORD}  (${txs.length} transactions, 2 cards, ${payments.length} payments, and a friend: @maria)`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
