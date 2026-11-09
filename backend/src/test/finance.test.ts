import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMonths, addMonthsToKey, buildInvoices, buildOccurrences, categoryViews, dueDateFor, findInvoice, fixedFieldsAt, invoicesNow, isDate, openInvoiceKey, remaining, toneFromWeight, withDay,
  type Card, type Payment, type Tx,
} from '../finance.js';

const tx = (over: Partial<Tx> = {}): Tx => ({ id: 't1', type: 'expense', description: 'Rent', amount: 100000, date: '2026-01-31', confirmed: false, fixed: false, confirmedMonths: [], ...over });
const card: Card = { id: 'c1', name: 'Visa', limit: 500000, dueDay: 10 };

test('dates: months are clamped, keys roll over years, impossible dates are refused', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonthsToKey('2026-11', 3), '2027-02');
  assert.equal(addMonthsToKey('2026-01', -1), '2025-12');
  assert.equal(withDay('2026-02-10', 31), '2026-02-28');
  assert.equal(isDate('2026-02-31'), false);
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('26-2-8'), false);
});

test('the open invoice is this month up to the due day, then the next one', () => {
  assert.equal(openInvoiceKey(card, '2026-11-10'), '2026-11');
  assert.equal(openInvoiceKey(card, '2026-11-11'), '2026-12');
  assert.equal(openInvoiceKey(card, '2026-12-20'), '2027-01');
  assert.equal(dueDateFor({ dueDay: 31 }, '2026-02'), '2026-02-28');
});

test('a fixed transaction expands one occurrence per month, with revisions and overrides applied in order', () => {
  const t = tx({ fixed: true, confirmedMonths: ['2026-02'], revisions: [{ from: '2026-03', amount: 120000 }, { from: '2026-05', amount: 130000, description: 'Rent+' }], overrides: { '2026-04': { amount: 90000 }, '2026-06': { day: 5 } } });
  const occ = buildOccurrences([t], [], '2026-06');
  assert.deepEqual(occ.map((o) => o.monthKey), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(occ.map((o) => o.amount), [100000, 100000, 120000, 90000, 130000, 130000]);
  assert.equal(occ[4]?.description, 'Rent+');
  assert.deepEqual(occ.map((o) => o.confirmed), [false, true, false, false, false, false]);
  assert.equal(occ[1]?.purchaseDate, '2026-02-28');
  assert.equal(occ[5]?.purchaseDate, '2026-06-05');
  assert.equal(fixedFieldsAt(t, '2026-04').amount, 90000);
  assert.equal(fixedFieldsAt(t, '2026-04').day, 31);
  // a revision applies from its month on and an override only to its own
  assert.equal(fixedFieldsAt(t, '2026-02').amount, 100000);
  assert.equal(fixedFieldsAt(t, '2026-12').description, 'Rent+');
});

test('invoices: purchases add up, income on the card reduces them, payments count, fixed ones follow the invoice month', () => {
  const txs: Tx[] = [
    tx({ id: 'a', amount: 30000, date: '2026-11-03', cardId: 'c1', invoiceKey: '2026-12' }),
    tx({ id: 'b', type: 'income', amount: 5000, date: '2026-11-04', cardId: 'c1', invoiceKey: '2026-12', category: 'refund' }),
    tx({ id: 'c', amount: 999, date: '2026-11-05' }),
    tx({ id: 'd', amount: 1000, date: '2026-11-06', cardId: 'c1', invoiceKey: '2026-12', fixed: true }),
  ];
  const pays: Payment[] = [{ id: 'p', cardId: 'c1', invoiceKey: '2026-12', amount: 10000, date: '2026-12-01' }];
  const inv = invoicesNow(txs, [card], pays, '2026-11-09');
  const dec = findInvoice(inv, card, '2026-12');
  assert.equal(dec.total, 26000);
  assert.equal(dec.paid, 10000);
  assert.equal(remaining(dec), 16000);
  assert.equal(dec.dueDate, '2026-12-10');
  assert.equal(findInvoice(inv, card, '2027-01').total, 1000);
  assert.equal(findInvoice(inv, card, '2025-01').total, 0);
  // archived transactions and payments are not on the invoice
  const archived = invoicesNow(txs.map((t) => (t.id === 'a' ? { ...t, archivedAt: 1 } : t)), [card], [{ ...pays[0]!, archivedAt: 1 }], '2026-11-09');
  assert.equal(findInvoice(archived, card, '2026-12').total, -4000);
  assert.equal(remaining(findInvoice(archived, card, '2026-12')), 0);
  // a card that is not known has no invoices
  assert.equal(buildInvoices([], buildOccurrences(txs, [card], '2026-12'), pays).length, 0);
});

test('categories: built-in ones carry the person\'s renames and archives; the system ones cannot be archived', () => {
  const views = categoryViews([
    { id: 'expense_leisure', slug: 'leisure', kind: 'expense', name: 'Fun', weight: 0.9 },
    { id: 'expense_pets', slug: 'pets', kind: 'expense', name: 'Pets', archivedAt: 5 },
    { id: 'expense_other', slug: 'other', kind: 'expense', name: 'Other', archivedAt: 5 },
    { id: 'abc', slug: 'abc', kind: 'income', name: 'Side gig', createdAt: 1 },
  ]);
  const get = (kind: string, slug: string) => views.find((v) => v.kind === kind && v.slug === slug)!;
  assert.equal(get('expense', 'leisure').name, 'Fun');
  assert.equal(get('expense', 'leisure').weight, 0.9);
  assert.equal(get('expense', 'pets').archived, true);
  assert.equal(get('expense', 'other').archived, false);
  assert.equal(get('expense', 'other').system, true);
  assert.equal(get('income', 'abc').custom, true);
  assert.equal(get('income', 'abc').tone, null);
  assert.equal(get('income', 'refund').name, 'Refund');
  assert.equal(toneFromWeight(0.1), 'necessary');
  assert.equal(toneFromWeight(0.45), 'comfort');
  assert.equal(toneFromWeight(0.9), 'luxury');
});
