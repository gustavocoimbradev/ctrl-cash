import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db.js';
import { addMonthsToKey } from '../finance.js';
import { bearer, newUid, setup } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
before(async () => ({ app, pool } = await setup()));
after(async () => {
  await app.close();
  await pool.end();
});

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const HOST = { host: 'cash.example.com', 'x-forwarded-proto': 'https' };
const TODAY = new Date().toISOString().slice(0, 10);
const THIS_MONTH = TODAY.slice(0, 7);

/** the whole way in as `uid` (register, approve, exchange the code); returns a caller for tools */
async function connect(uid: string, write = true) {
  const reg = (await app.inject({ method: 'POST', url: '/api/oauth/register', headers: HOST, payload: { client_name: 'Claude', redirect_uris: [REDIRECT] } as object })).json() as any;
  const verifier = randomBytes(32).toString('base64url');
  const approve = await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: bearer(uid), payload: { client_id: reg.client_id, redirect_uri: REDIRECT, state: 'x', code_challenge: createHash('sha256').update(verifier).digest('base64url'), write } as object });
  assert.equal(approve.statusCode, 200);
  const code = new URL(approve.json().redirect).searchParams.get('code')!;
  const t = await app.inject({ method: 'POST', url: '/api/oauth/token', headers: { ...HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }).toString() });
  assert.equal(t.statusCode, 200);
  const access = t.json().access_token as string;
  const call = async (name: string, args: unknown = {}) => {
    const r = (await app.inject({ method: 'POST', url: '/api/mcp', headers: { ...HOST, authorization: `Bearer ${access}` }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as object })).json().result as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: r.isError === true, json: () => JSON.parse(r.content[0]!.text) };
  };
  const data = async () => (await app.inject({ method: 'GET', url: '/api/data', headers: bearer(uid) })).json() as Record<'transactions' | 'cards' | 'payments' | 'categories', any[]>;
  /** a tool that must work; returns its text */
  const ok = async (name: string, args: unknown = {}) => {
    const r = await call(name, args);
    assert.equal(r.isError, false, `${name}: ${r.text}`);
    return r;
  };
  /** a tool that must be refused; returns the message */
  const refused = async (name: string, args: unknown, pattern: RegExp) => {
    const r = await call(name, args);
    assert.equal(r.isError, true, `${name} should be refused, got: ${r.text}`);
    assert.match(r.text, /^Not done: /);
    assert.match(r.text, pattern);
    return r.text;
  };
  return { uid, call, data, ok, refused };
}
const fresh = () => connect(newUid());

test('a read-only connection cannot change anything, but the read tools work', async () => {
  const c = await connect(newUid(), false);
  const r = await c.call('add_card', { name: 'Visa', limit: 1000, dueDay: 10 });
  assert.equal(r.isError, true);
  assert.match(r.text, /read-only/);
  assert.equal((await c.data()).cards.length, 0);
  assert.equal((await c.ok('search_transactions')).json().matches, 0);
  assert.equal((await c.ok('list_invoices')).json().cards.length, 0);
  assert.deepEqual((await c.ok('list_payments')).json().payments, []);
});

test('the tools are listed with their schemas', async () => {
  const names = ['search_transactions', 'list_invoices', 'list_payments', 'update_transaction', 'archive_transaction', 'restore_transaction', 'confirm_transaction', 'add_card', 'update_card', 'archive_card', 'restore_card', 'add_category', 'update_category', 'archive_category', 'restore_category', 'pay_invoice', 'archive_payment', 'adjust_invoice', 'set_preferences'];
  const { dataTools } = await import('../tools-data.js');
  for (const n of names) {
    const t = dataTools.find((x) => x.name === n);
    assert.ok(t, n);
    assert.equal((t.inputSchema as any).type, 'object');
    assert.ok(t.description.length > 10);
  }
  assert.deepEqual(dataTools.filter((t) => t.scope === 'read').map((t) => t.name), ['search_transactions', 'list_invoices', 'list_payments']);
});

test('cards: add, update, archive and restore, amounts in whole units stored in cents', async () => {
  const c = await fresh();
  await c.ok('add_card', { name: 'Visa Gold', limit: 5000.5, dueDay: 12, color: 'Coral' });
  let card = (await c.data()).cards[0]!;
  assert.equal(card.name, 'Visa Gold');
  assert.equal(card.limit, 500050);
  assert.equal(card.dueDay, 12);
  assert.equal(card.color, '#E0446A');
  await c.ok('add_card', { name: 'Master', limit: 100, dueDay: 31 });
  assert.equal((await c.data()).cards[1]!.color, '#8B3FD9');

  await c.refused('add_card', { name: 'visa gold', limit: 10, dueDay: 5 }, /already a card/);
  await c.refused('add_card', { name: 'X', limit: 0, dueDay: 5 }, /limit/);
  await c.refused('add_card', { name: 'X', limit: 10, dueDay: 32 }, /dueDay/);
  await c.refused('add_card', { name: 'X', limit: 10, dueDay: 5, color: 'green' }, /color/);
  await c.refused('add_card', { name: 'X', limit: 10, dueDay: 5, bogus: 1 }, /unknown argument/);

  await c.ok('update_card', { card: 'GOLD', limit: 6000, dueDay: 5, name: 'Gold', color: '#112233' });
  card = (await c.data()).cards.find((x) => x.id === card.id)!;
  assert.deepEqual([card.name, card.limit, card.dueDay, card.color], ['Gold', 600000, 5, '#112233']);
  await c.refused('update_card', { card: 'Gold' }, /nothing to change/);
  await c.refused('update_card', { card: 'Gold', name: 'master' }, /already a card/);
  await c.refused('update_card', { card: 'nope', name: 'Z' }, /unknown card "nope".*Gold, Master/);

  await c.ok('add_card', { name: 'Master Black', limit: 100, dueDay: 3 });
  await c.refused('update_card', { card: 'Mas', name: 'Z' }, /matches more than one card.*Master, Master Black/);
  await c.ok('update_card', { card: 'master black', limit: 200 });

  await c.ok('archive_card', { card: 'Gold' });
  assert.ok((await c.data()).cards.find((x) => x.id === card.id)!.archivedAt);
  await c.refused('archive_card', { card: 'Gold' }, /unknown card/);
  await c.refused('add_transaction', { type: 'expense', description: 'x', amount: 1, card: 'Gold' }, /unknown card/);
  await c.refused('restore_card', { card: 'Master' }, /unknown archived card/);
  await c.ok('restore_card', { card: 'gold' });
  assert.equal((await c.data()).cards.find((x) => x.id === card.id)!.archivedAt, undefined);
  assert.equal((await c.data()).cards.length, 3);
});

test('categories: custom ones, built-in renames stored as records, archive and restore, system ones protected', async () => {
  const c = await fresh();
  await c.ok('add_category', { kind: 'expense', name: 'Coffee', impact: 'discretionary', tone: 'luxury' });
  await c.ok('add_category', { kind: 'income', name: 'Side gig' });
  let cats = (await c.data()).categories;
  const coffee = cats.find((x) => x.name === 'Coffee')!;
  assert.equal(coffee.slug, coffee.id);
  assert.equal(coffee.weight, 0.9);
  assert.equal(coffee.tone, 'luxury');
  assert.equal(cats.find((x) => x.name === 'Side gig')!.weight, undefined);
  await c.refused('add_category', { kind: 'expense', name: 'coffee' }, /already/);
  await c.refused('add_category', { kind: 'expense', name: 'Leisure' }, /already/);
  await c.refused('add_category', { kind: 'income', name: 'Z', impact: 'regular' }, /only apply to expense/);
  await c.refused('add_category', { kind: 'other', name: 'Z' }, /kind/);

  // it is usable by name right away
  await c.ok('add_transaction', { type: 'expense', description: 'Latte', amount: 4, category: 'coffee' });
  assert.equal((await c.data()).transactions[0]!.category, coffee.id);

  // a built-in one gets a record the first time it changes, with the English base name when the name is untouched
  await c.ok('update_category', { category: 'leisure', impact: 'essential' });
  cats = (await c.data()).categories;
  const leisure = cats.find((x) => x.id === 'expense_leisure')!;
  assert.deepEqual([leisure.slug, leisure.kind, leisure.name, leisure.weight], ['leisure', 'expense', 'Leisure', 0.1]);
  await c.ok('update_category', { category: 'Leisure', name: 'Fun', tone: 'comfort' });
  assert.equal((await c.data()).categories.find((x) => x.id === 'expense_leisure')!.name, 'Fun');
  await c.ok('add_transaction', { type: 'expense', description: 'Cinema', amount: 10, category: 'fun' });
  await c.refused('update_category', { category: 'fun', name: 'Coffee' }, /already/);
  await c.refused('update_category', { category: 'fun' }, /nothing to change/);
  await c.refused('update_category', { category: 'salary', impact: 'regular' }, /only apply to expense/);

  // Refund exists as expense and income
  await c.refused('update_category', { category: 'refund', name: 'Back' }, /more than one category/);
  await c.ok('update_category', { category: 'refund', kind: 'income', name: 'Payback' });
  assert.equal((await c.data()).categories.find((x) => x.id === 'income_refund')!.name, 'Payback');

  // system categories cannot be archived
  for (const slug of ['loan', 'other']) await c.refused('archive_category', { category: slug }, /system category/);
  await c.refused('archive_category', { category: 'payback', kind: 'income' }, /system category/);

  await c.ok('archive_category', { category: 'pets' });
  const pets = (await c.data()).categories.find((x) => x.id === 'expense_pets')!;
  assert.ok(pets.archivedAt);
  assert.equal(pets.name, 'Pets');
  await c.refused('add_transaction', { type: 'expense', description: 'Food', amount: 5, category: 'pets' }, /archived|unknown/);
  await c.refused('archive_category', { category: 'pets' }, /unknown category/);
  await c.ok('restore_category', { category: 'pets' });
  assert.equal((await c.data()).categories.find((x) => x.id === 'expense_pets')!.archivedAt, undefined);
  await c.ok('add_transaction', { type: 'expense', description: 'Food', amount: 5, category: 'pets' });

  await c.ok('archive_category', { category: 'coffee' });
  assert.ok((await c.data()).categories.find((x) => x.id === coffee.id)!.archivedAt);
  assert.equal((await c.data()).transactions.find((t) => t.description === 'Latte')!.category, coffee.id);
  await c.ok('restore_category', { category: 'Coffee' });
  await c.refused('restore_category', { category: 'Coffee' }, /unknown archived category/);
});

const findTx = async (c: Awaited<ReturnType<typeof fresh>>, description: string) => (await c.data()).transactions.filter((t) => t.description === description);

test('searching: filters, fixed transactions per month, card name, installments, archived left out', async () => {
  const c = await fresh();
  await c.ok('add_card', { name: 'Visa', limit: 1000, dueDay: 10 });
  await c.ok('add_transaction', { type: 'expense', description: 'Pharmacy', amount: 30.5, date: TODAY, category: 'health' });
  await c.ok('add_transaction', { type: 'income', description: 'Pay', amount: 1000, date: TODAY, category: 'salary' });
  await c.ok('add_transaction', { type: 'expense', description: 'Sofa', amount: 300, date: TODAY, card: 'Visa', installments: 3 });
  await c.ok('add_transaction', { type: 'expense', description: 'Gym', amount: 50, date: addMonthsToKey(THIS_MONTH, -2) + '-05', fixed: true, category: 'health' });

  const all = (await c.ok('search_transactions', { limit: 50 })).json();
  assert.equal(all.currency, 'USD');
  assert.equal(all.matches, 8);
  const pharmacy = all.transactions.find((t: any) => t.description === 'Pharmacy');
  assert.deepEqual([pharmacy.amount, pharmacy.type, pharmacy.category, pharmacy.confirmed, pharmacy.fixed], [30.5, 'expense', 'health', true, false]);
  assert.equal(all.transactions.filter((t: any) => t.description === 'Gym').length, 3);
  assert.deepEqual(all.transactions.filter((t: any) => t.description === 'Gym').map((t: any) => t.month).sort(), [addMonthsToKey(THIS_MONTH, -2), addMonthsToKey(THIS_MONTH, -1), THIS_MONTH]);
  const sofa = all.transactions.filter((t: any) => t.description === 'Sofa').sort((a: any, b: any) => a.installment.index - b.installment.index);
  assert.deepEqual(sofa.map((t: any) => [t.card, t.installment, t.amount, t.confirmed]), [['Visa', { index: 1, total: 3 }, 100, false], ['Visa', { index: 2, total: 3 }, 100, false], ['Visa', { index: 3, total: 3 }, 100, false]]);
  assert.match(sofa[0].invoiceKey, /^\d{4}-\d{2}$/);

  assert.equal((await c.ok('search_transactions', { query: 'PHARMÁCY'.replace('Á', 'A') })).json().matches, 1);
  assert.equal((await c.ok('search_transactions', { type: 'income' })).json().transactions[0].description, 'Pay');
  assert.equal((await c.ok('search_transactions', { card: 'vis' })).json().matches, 3);
  assert.equal((await c.ok('search_transactions', { category: 'Health' })).json().matches, 4);
  assert.equal((await c.ok('search_transactions', { limit: 2 })).json().shown, 2);
  assert.equal((await c.ok('search_transactions', { from: TODAY, to: TODAY, type: 'expense' })).json().matches >= 2, true);
  await c.refused('search_transactions', { category: 'nope' }, /unknown category/);
  await c.refused('search_transactions', { from: '2026-13-01' }, /from/);
  await c.refused('search_transactions', { limit: 500 }, /limit/);

  const id = pharmacy.id as string;
  await c.ok('archive_transaction', { id });
  assert.equal((await c.ok('search_transactions', { query: 'Pharmacy' })).json().matches, 0);
  assert.equal((await c.ok('search_transactions', { query: 'Pharmacy', archived: true })).json().matches, 1);
});

test('updating a one-time transaction, and archive / restore / confirm round trips', async () => {
  const c = await fresh();
  await c.ok('add_transaction', { type: 'expense', description: 'Pharmacy', amount: 30, date: TODAY, category: 'health', confirmed: false });
  const t = (await findTx(c, 'Pharmacy'))[0]!;
  assert.equal(t.confirmed, false);
  await c.ok('update_transaction', { id: t.id, description: 'Drugstore', amount: 31.25, date: '2026-05-04', category: 'Groceries', confirmed: true });
  let now = (await c.data()).transactions[0]!;
  assert.deepEqual([now.description, now.amount, now.date, now.category, now.confirmed], ['Drugstore', 3125, '2026-05-04', 'groceries', true]);

  await c.refused('update_transaction', { id: t.id }, /nothing to change/);
  await c.refused('update_transaction', { id: t.id, amount: -3 }, /amount/);
  await c.refused('update_transaction', { id: t.id, amount: 'ten' }, /amount/);
  await c.refused('update_transaction', { id: t.id, date: '2026-02-30' }, /date/);
  await c.refused('update_transaction', { id: t.id, date: '2090-01-01' }, /two years/);
  await c.refused('update_transaction', { id: t.id, description: '' }, /description/);
  await c.refused('update_transaction', { id: t.id, category: 'salary' }, /unknown expense category.*Groceries/);
  await c.refused('update_transaction', { id: t.id, card: 'Nope' }, /unknown card/);
  await c.refused('update_transaction', { id: t.id, scope: 'all', amount: 3 }, /only applies to monthly/);
  await c.refused('update_transaction', { id: t.id, category: 'loan' }, /Loan.*card/);
  await c.refused('update_transaction', { id: 'does-not-exist', amount: 3 }, /no transaction with that id/);

  // confirm / pending
  await c.ok('confirm_transaction', { id: t.id, confirmed: false });
  assert.equal((await c.data()).transactions[0]!.confirmed, false);
  await c.ok('confirm_transaction', { id: t.id });
  assert.equal((await c.data()).transactions[0]!.confirmed, true);
  await c.refused('confirm_transaction', { id: t.id, month: '2026-05' }, /only applies to monthly/);

  // on a card: never confirmed
  await c.ok('add_card', { name: 'Visa', limit: 1000, dueDay: 10 });
  await c.refused('update_transaction', { id: t.id, card: 'Visa', confirmed: true }, /never confirmed/);
  await c.ok('update_transaction', { id: t.id, card: 'Visa' });
  now = (await c.data()).transactions[0]!;
  assert.equal(now.confirmed, false);
  assert.ok(now.cardId);
  assert.match(now.invoiceKey, /^\d{4}-\d{2}$/);
  await c.refused('confirm_transaction', { id: t.id }, /never confirmed/);
  await c.ok('update_transaction', { id: t.id, card: 'none' });
  now = (await c.data()).transactions[0]!;
  assert.equal(now.cardId, undefined);
  assert.equal(now.invoiceKey, undefined);

  // archive and restore: the row stays
  await c.ok('archive_transaction', { id: t.id });
  assert.ok((await c.data()).transactions[0]!.archivedAt);
  assert.equal((await c.data()).transactions.length, 1);
  await c.refused('update_transaction', { id: t.id, amount: 5 }, /archived/);
  await c.refused('confirm_transaction', { id: t.id }, /archived/);
  assert.match((await c.ok('archive_transaction', { id: t.id })).text, /already archived/);
  await c.ok('restore_transaction', { id: t.id });
  assert.equal((await c.data()).transactions[0]!.archivedAt, undefined);
  assert.match((await c.ok('restore_transaction', { id: t.id })).text, /already active/);
});

test('installments: description, category and card go to the whole group; amount, date and confirmed to one; archive together', async () => {
  const c = await fresh();
  await c.ok('add_card', { name: 'Visa', limit: 5000, dueDay: 10 });
  await c.ok('add_transaction', { type: 'expense', description: 'Fridge', amount: 900, date: TODAY, installments: 3, category: 'other' });
  const group = () => findTx(c, 'Fridge').then((l) => l.sort((a, b) => a.installment.index - b.installment.index));
  const second = (await group())[1]!;
  await c.ok('update_transaction', { id: second.id, description: 'Fridge LG', category: 'bills', amount: 310, date: '2026-12-15', confirmed: true });
  const names = await findTx(c, 'Fridge LG');
  assert.equal(names.length, 3);
  assert.deepEqual(names.map((t) => t.category), ['bills', 'bills', 'bills']);
  const sorted = names.sort((a, b) => a.installment.index - b.installment.index);
  assert.deepEqual(sorted.map((t) => t.amount), [30000, 31000, 30000]);
  assert.deepEqual(sorted.map((t) => t.date === '2026-12-15'), [false, true, false]);
  assert.deepEqual(sorted.map((t) => t.confirmed), [true, true, false]);

  // putting the group on a card: every installment lands on a consecutive invoice, nothing is confirmed
  await c.ok('update_transaction', { id: second.id, card: 'Visa' });
  const onCard = (await findTx(c, 'Fridge LG')).sort((a, b) => a.installment.index - b.installment.index);
  assert.ok(onCard.every((t) => t.cardId && !t.confirmed));
  const keys = onCard.map((t) => t.invoiceKey as string);
  assert.deepEqual(keys, [keys[0], addMonthsToKey(keys[0]!, 1), addMonthsToKey(keys[0]!, 2)]);
  assert.equal(new Set(onCard.map((t) => t.installment.groupId)).size, 1);

  const before = (await c.data()).transactions.length;
  await c.ok('archive_transaction', { id: onCard[0]!.id });
  assert.ok((await findTx(c, 'Fridge LG')).every((t) => t.archivedAt));
  assert.equal((await c.data()).transactions.length, before);
  assert.equal((await c.ok('search_transactions', { query: 'Fridge' })).json().matches, 0);
  await c.ok('restore_transaction', { id: onCard[2]!.id });
  assert.ok((await findTx(c, 'Fridge LG')).every((t) => !t.archivedAt));
});

test('monthly (fixed) transactions: scopes use overrides and revisions, confirmation is per month', async () => {
  const c = await fresh();
  const start = addMonthsToKey(THIS_MONTH, -3);
  await c.ok('add_transaction', { type: 'expense', description: 'Rent', amount: 1000, date: `${start}-05`, fixed: true, category: 'bills' });
  const id = (await findTx(c, 'Rent'))[0]!.id as string;
  const row = async () => (await c.data()).transactions.find((t) => t.id === id)!;
  const m1 = addMonthsToKey(start, 1);
  const m2 = addMonthsToKey(start, 2);

  // only one month (the default scope): an override
  await c.ok('update_transaction', { id, month: m1, amount: 900 });
  assert.deepEqual((await row()).overrides, { [m1]: { amount: 90000 } });
  assert.equal((await row()).amount, 100000);
  // from a month on: a revision, and it supersedes the later override
  await c.ok('update_transaction', { id, month: m1, amount: 1200, description: 'Rent 2', scope: 'from_this_month' });
  let r = await row();
  assert.deepEqual(r.revisions, [{ from: m1, amount: 120000, description: 'Rent 2' }]);
  assert.equal(r.overrides, undefined);
  // another override in a later month, read back through the occurrences
  await c.ok('update_transaction', { id, month: m2, amount: 50, scope: 'this_month', date: `${m2}-20` });
  const found = (await c.ok('search_transactions', { query: 'Rent' })).json().transactions as any[];
  const byMonth = Object.fromEntries(found.map((t) => [t.month, [t.description, t.amount, t.date]]));
  assert.deepEqual(byMonth[start], ['Rent', 1000, `${start}-05`]);
  assert.deepEqual(byMonth[m1], ['Rent 2', 1200, `${m1}-05`]);
  assert.deepEqual(byMonth[m2], ['Rent 2', 50, `${m2}-20`]);
  // everything: base values change and per-month edits of those fields go away
  await c.ok('update_transaction', { id, amount: 1100, scope: 'all' });
  r = await row();
  assert.equal(r.amount, 110000);
  assert.equal(JSON.stringify(r.revisions ?? []).includes('amount'), false);
  assert.equal(JSON.stringify(r.overrides ?? {}).includes('amount'), false);

  await c.refused('update_transaction', { id, month: addMonthsToKey(start, -1), amount: 5 }, /starts in/);
  await c.refused('update_transaction', { id, month: 'soon', amount: 5 }, /month/);
  await c.refused('update_transaction', { id, amount: 5, scope: 'forever' }, /scope/);
  await c.refused('update_transaction', { id, month: m1, date: `${m2}-02`, amount: 5 }, /must be in/);

  // confirmation is per month
  await c.ok('confirm_transaction', { id, month: m1 });
  await c.ok('update_transaction', { id, month: m2, confirmed: true });
  assert.deepEqual((await row()).confirmedMonths.sort(), [start, m1, m2]);
  await c.ok('confirm_transaction', { id, month: m1, confirmed: false });
  assert.deepEqual((await row()).confirmedMonths.sort(), [start, m2]);
  const confirmedByMonth = Object.fromEntries(((await c.ok('search_transactions', { query: 'Rent' })).json().transactions as any[]).map((t) => [t.month, t.confirmed]));
  assert.equal(confirmedByMonth[m2], true);
  assert.equal(confirmedByMonth[m1], false);

  // moving a fixed charge onto a card clears its confirmations and never confirms it
  await c.ok('add_card', { name: 'Visa', limit: 5000, dueDay: 10 });
  await c.refused('update_transaction', { id, card: 'Visa', confirmed: true }, /never confirmed/);
  await c.ok('update_transaction', { id, card: 'Visa' });
  r = await row();
  assert.deepEqual(r.confirmedMonths, []);
  assert.ok(r.cardId && r.invoiceKey);
  await c.ok('archive_transaction', { id });
  await c.ok('restore_transaction', { id });
  assert.equal((await row()).archivedAt, undefined);
});

test('invoices: totals match the app, payments, archive and restore, adjustments up and down', async () => {
  const c = await fresh();
  await c.ok('add_card', { name: 'Visa', limit: 5000, dueDay: 28 });
  // invoice "open": a purchase today lands on this month's invoice while today <= 28, else on the next one
  const openKey = Number(TODAY.slice(8, 10)) <= 28 ? THIS_MONTH : addMonthsToKey(THIS_MONTH, 1);
  await c.ok('add_transaction', { type: 'expense', description: 'TV', amount: 400, card: 'Visa', invoice: 'open' });
  await c.ok('add_transaction', { type: 'expense', description: 'Phone', amount: 600, card: 'Visa', invoice: 'open', installments: 2 });
  const listed = async () => (await c.ok('list_invoices', { card: 'visa' })).json().cards[0];
  const inv = async (key: string) => (await listed()).invoices.find((i: any) => i.invoice === key);
  let card = await listed();
  assert.deepEqual([card.name, card.limit, card.dueDay, card.openInvoice], ['Visa', 5000, 28, openKey]);
  assert.deepEqual(await inv(openKey), { invoice: openKey, dueDate: `${openKey}-28`, total: 700, paid: 0, remaining: 700, open: true });
  assert.equal((await inv(addMonthsToKey(openKey, 1))).total, 300);

  // paying
  await c.refused('pay_invoice', { card: 'Visa', invoice: 'open', amount: 0 }, /amount/);
  await c.refused('pay_invoice', { card: 'Visa', invoice: 'next', amount: 5 }, /invoice/);
  await c.refused('pay_invoice', { card: 'Nope', invoice: 'open', amount: 5 }, /unknown card/);
  await c.refused('pay_invoice', { card: 'Visa', invoice: 'open', amount: 5, date: '31/12/2026' }, /date/);
  const paid = (await c.ok('pay_invoice', { card: 'Visa', invoice: 'open', amount: 250.5 })).text;
  assert.match(paid, /Remaining on that invoice: 449\.50/);
  await c.ok('pay_invoice', { card: 'Visa', invoice: openKey, amount: 49.5, date: TODAY });
  const stored = (await c.data()).payments;
  assert.deepEqual(stored.map((p) => [p.invoiceKey, p.amount, p.date]), [[openKey, 25050, TODAY], [openKey, 4950, TODAY]]);
  assert.deepEqual(await inv(openKey), { invoice: openKey, dueDate: `${openKey}-28`, total: 700, paid: 300, remaining: 400, open: true });

  const pays = (await c.ok('list_payments', { card: 'Visa' })).json().payments;
  assert.equal(pays.length, 2);
  assert.deepEqual(pays.map((p: any) => [p.card, p.invoice]), [['Visa', openKey], ['Visa', openKey]]);
  const target = pays.find((p: any) => p.amount === 49.5);
  await c.ok('archive_payment', { id: target.id });
  assert.equal((await inv(openKey)).paid, 250.5);
  assert.equal((await c.data()).payments.length, 2);
  assert.equal((await c.ok('list_payments')).json().payments.length, 1);
  assert.equal((await c.ok('list_payments', { archived: true })).json().payments[0].id, target.id);
  assert.match((await c.ok('archive_payment', { id: target.id })).text, /already archived/);
  await c.ok('restore_payment', { id: target.id });
  assert.equal((await inv(openKey)).paid, 300);
  await c.refused('archive_payment', { id: 'nope' }, /no payment with that id/);

  // adjustments: the invoice becomes what the bank says
  assert.match((await c.ok('adjust_invoice', { card: 'Visa', invoice: openKey, newTotal: 700 })).text, /nothing to adjust/);
  await c.ok('adjust_invoice', { card: 'Visa', invoice: 'open', newTotal: 750.25 });
  let adj = (await findTx(c, 'Invoice adjustment'))[0]!;
  assert.deepEqual([adj.type, adj.amount, adj.category, adj.confirmed, adj.invoiceKey, adj.fixed, adj.date], ['expense', 5025, 'other', false, openKey, false, TODAY]);
  assert.equal((await inv(openKey)).total, 750.25);
  await c.ok('adjust_invoice', { card: 'Visa', invoice: openKey, newTotal: 700 });
  adj = (await findTx(c, 'Invoice adjustment')).find((t) => t.type === 'income')!;
  assert.deepEqual([adj.amount, adj.category, adj.invoiceKey], [5025, 'refund', openKey]);
  assert.equal((await inv(openKey)).total, 700);
  await c.ok('adjust_invoice', { card: 'Visa', invoice: openKey, newTotal: 0 });
  assert.equal((await inv(openKey)).total, 0);
  assert.equal((await inv(openKey)).remaining, 0);
  await c.refused('adjust_invoice', { card: 'Visa', invoice: openKey, newTotal: -1 }, /newTotal/);
  await c.refused('adjust_invoice', { card: 'Visa', invoice: '2026-1', newTotal: 5 }, /invoice/);
  card = await listed();
  assert.equal(card.invoices.length >= 2, true);
});

test('preferences: language and currency, and amounts follow the currency\'s decimals', async () => {
  const c = await fresh();
  await c.ok('set_preferences', { currency: 'jpy' });
  let s = (await app.inject({ method: 'GET', url: '/api/settings', headers: bearer(c.uid) })).json().settings;
  assert.deepEqual(s, { language: 'en', currency: 'JPY' });
  await c.ok('add_card', { name: 'Yen', limit: 50000, dueDay: 3 });
  assert.equal((await c.data()).cards[0]!.limit, 50000);
  await c.ok('set_preferences', { language: 'pt' });
  s = (await app.inject({ method: 'GET', url: '/api/settings', headers: bearer(c.uid) })).json().settings;
  assert.deepEqual(s, { language: 'pt', currency: 'JPY' });
  await c.refused('set_preferences', {}, /nothing to change/);
  await c.refused('set_preferences', { language: 'xx' }, /language/);
  await c.refused('set_preferences', { currency: 'DOLLAR' }, /currency/);
  await c.refused('set_preferences', { currency: 'ZZZ' }, /currency/);
});

test('one person can never reach another person\'s ids or names', async () => {
  const a = await fresh();
  const b = await fresh();
  await a.ok('add_card', { name: 'Secret card', limit: 1000, dueDay: 5 });
  await a.ok('add_category', { kind: 'expense', name: 'Secret category' });
  await a.ok('add_transaction', { type: 'expense', description: 'Secret', amount: 10, date: TODAY });
  await a.ok('add_transaction', { type: 'expense', description: 'Secret card buy', amount: 10, date: TODAY, card: 'Secret card' });
  await a.ok('pay_invoice', { card: 'Secret card', invoice: 'open', amount: 5 });
  const tx = (await findTx(a, 'Secret'))[0]!;
  const payment = (await a.data()).payments[0]!;
  const snapshot = JSON.stringify(await a.data());

  await b.refused('update_transaction', { id: tx.id, amount: 1 }, /no transaction with that id/);
  await b.refused('archive_transaction', { id: tx.id }, /no transaction with that id/);
  await b.refused('restore_transaction', { id: tx.id }, /no transaction with that id/);
  await b.refused('confirm_transaction', { id: tx.id }, /no transaction with that id/);
  await b.refused('archive_payment', { id: payment.id }, /no payment with that id/);
  await b.refused('restore_payment', { id: payment.id }, /no payment with that id/);
  await b.refused('update_card', { card: 'Secret card', limit: 1 }, /unknown card/);
  await b.refused('archive_card', { card: 'Secret card' }, /unknown card/);
  await b.refused('pay_invoice', { card: 'Secret card', invoice: 'open', amount: 1 }, /unknown card/);
  await b.refused('adjust_invoice', { card: 'Secret card', invoice: 'open', newTotal: 1 }, /unknown card/);
  await b.refused('update_category', { category: 'Secret category', name: 'x' }, /unknown category/);
  await b.refused('archive_category', { category: 'Secret category' }, /unknown category/);
  await b.refused('list_invoices', { card: 'Secret card' }, /unknown card/);
  await b.refused('list_payments', { card: 'Secret card' }, /unknown card/);
  assert.equal((await b.ok('search_transactions')).json().matches, 0);
  assert.equal((await b.ok('search_transactions', { query: 'Secret' })).json().matches, 0);
  assert.deepEqual((await b.ok('list_payments')).json().payments, []);
  assert.equal((await b.ok('list_invoices')).json().cards.length, 0);
  // and nothing of theirs changed
  assert.equal(JSON.stringify(await a.data()), snapshot);
  assert.equal(Object.values(await b.data()).flat().length, 0);
});

test('every change is logged for the person and nothing is ever removed from the database', async () => {
  const c = await fresh();
  await c.ok('add_card', { name: 'Visa', limit: 1000, dueDay: 5 });
  await c.ok('archive_card', { card: 'Visa' });
  const actions = await pool.query('select tool from assistant_actions where user_id = $1 order by created_at_ms', [c.uid]);
  assert.deepEqual(actions.rows.map((r) => r.tool), ['add_card', 'archive_card']);
  // reads are not logged
  await c.ok('search_transactions');
  assert.equal((await pool.query('select count(*)::int as n from assistant_actions where user_id = $1', [c.uid])).rows[0].n, 2);
  assert.equal((await pool.query('select count(*)::int as n from cards where user_id = $1', [c.uid])).rows[0].n, 1);
});
