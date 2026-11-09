import assert from 'node:assert/strict';
import { test } from 'node:test';
import { full, samples, tx } from './helpers.js';
import { validate, type Collection, type Doc } from '../validate.js';

const ok = (c: Collection, d: Doc) => assert.equal(validate(c, d), null, `expected valid: ${JSON.stringify(d)}`);
const bad = (c: Collection, d: unknown) => assert.notEqual(validate(c, d), null, `expected invalid: ${JSON.stringify(d)}`);

test('every full and minimal sample is valid', () => {
  for (const [c, d] of Object.entries(samples)) ok(c as Collection, d);
  for (const [c, d] of Object.entries(full)) ok(c as Collection, d);
});

test('transactions: invalid cases', () => {
  for (const over of [
    { amount: 0 }, { amount: 12.5 }, { amount: -3 }, { amount: 100000000001 }, { amount: '5' }, { type: 'transfer' },
    { date: '30/10/2026' }, { date: '2026-02-31' }, { description: 'x'.repeat(101) }, { description: '' },
    { extra: 'unknown field' }, { id: 'bad id!' }, { id: 'x'.repeat(101) }, { invoiceKey: '2026-1' },
    { installment: { index: 1, total: 3 } }, { installment: { index: 0, total: 3, groupId: 'g' } },
    { installment: { index: 1, total: 121, groupId: 'g' } }, { installment: { index: 1, total: 3, groupId: 'g', x: 1 } },
    { confirmed: 'yes' }, { fixed: 1 }, { confirmedMonths: 'x' }, { confirmedMonths: Array(601).fill('2026-01') },
    { reserveId: 'r1', cardId: 'c1' }, { type: 'income', reserveId: 'r1' }, { cardId: '' }, { category: 'x'.repeat(41) },
    { createdAt: 'now' }, { archivedAt: 'yesterday' }, { archivedAt: null },
    { revisions: [] }, // not fixed
    { overrides: {} }, // not fixed
    { fixed: true, revisions: 'x' }, { fixed: true, overrides: [1] },
    { fixed: true, revisions: Array.from({ length: 61 }, () => ({})) },
  ]) bad('transactions', tx(over));
  bad('transactions', { id: 't1', type: 'expense' });
  bad('transactions', 'text');
  bad('transactions', null);
  bad('transactions', []);
  ok('transactions', tx({ reserveId: 'r1' }));
  ok('transactions', tx({ fixed: true, revisions: [{ from: '2026-12' }], overrides: { '2026-11': { amount: 1 } } }));
});

test('cards and payments', () => {
  const card = (o: Doc = {}) => ({ ...samples.cards, ...o });
  for (const o of [{ dueDay: 40 }, { dueDay: 0 }, { dueDay: 1.5 }, { name: '' }, { name: 'n'.repeat(61) }, { limit: 0 }, { color: 'purple' }, { color: '#8B3FD9; x' }, { extra: 1 }]) bad('cards', card(o));
  ok('cards', card({ color: '#8B3FD9' }));
  const pay = (o: Doc = {}) => ({ ...samples.payments, ...o });
  for (const o of [{ amount: -1 }, { invoiceKey: '2026-1' }, { date: 'yesterday' }, { cardId: '' }, { createdAt: 1 }]) bad('payments', pay(o));
});

test('reserves and moves', () => {
  const r = (o: Doc = {}) => ({ ...samples.reserves, ...o });
  for (const o of [{ name: '' }, { saldo: 999999 }, { goal: 0 }, { goal: 12.5 }]) bad('reserves', r(o));
  ok('reserves', r({ goal: 500000 }));
  const m = (o: Doc = {}) => ({ ...samples.reserveMoves, ...o });
  for (const o of [{ confirmed: 'yes' }, { type: 'transfer' }, { amount: -1 }, { date: 'ontem' }, { reserveId: 'r'.repeat(41) }]) bad('reserveMoves', m(o));
  ok('reserveMoves', m({ confirmed: false }));
});

test('categories', () => {
  const c = (o: Doc = {}) => ({ ...samples.categories, ...o });
  for (const o of [{ kind: 'transfer' }, { name: '' }, { name: 'n'.repeat(41) }, { weight: 2 }, { weight: -0.1 }, { kind: 'income', weight: 0.5 }, { extra: true }, { slug: '' }, { tone: 'tasty' }, { tone: 3 }, { kind: 'income', tone: 'healthy' }]) bad('categories', c(o));
  ok('categories', c({ weight: 0 }));
  for (const tone of ['healthy', 'necessary', 'comfort', 'luxury', 'unhealthy', 'unknown']) ok('categories', c({ tone }));
  const { weight: _w, ...noWeight } = c({ kind: 'income' });
  ok('categories', noWeight);
});
