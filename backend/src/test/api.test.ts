import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { upsertDocs, withTransaction, type Pool } from '../db.js';
import { COLLECTIONS, type Doc } from '../validate.js';
import { bearer, full, newUid, samples, setup, tx } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
before(async () => ({ app, pool } = await setup()));
after(async () => {
  await app.close();
  await pool.end();
});

const put = (uid: string, payload: unknown) => app.inject({ method: 'PUT', url: '/api/data', headers: bearer(uid), payload: payload as object });
const get = async (uid: string) => (await app.inject({ method: 'GET', url: '/api/data', headers: bearer(uid) })).json() as Record<string, Doc[]>;

test('health: ok without auth and checks the database', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { status: 'ok' });
});

test('security headers are present', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('401 without token, with a bad token, and a wrong scheme', async () => {
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'Basic tok:x' }, { authorization: 'Bearer ' }]) {
    for (const method of ['GET', 'PUT'] as const) {
      const r = await app.inject({ method, url: '/api/data', headers, payload: method === 'PUT' ? {} : undefined });
      assert.equal(r.statusCode, 401);
      assert.deepEqual(r.json(), { error: 'unauthorized' });
    }
  }
});

test('empty account reads all collections as empty lists', async () => {
  const d = await get(newUid());
  assert.deepEqual(d, { transactions: [], cards: [], payments: [], reserves: [], reserveMoves: [], categories: [] });
});

test('upsert + read back for every collection (minimal and complete docs)', async () => {
  const uid = newUid();
  const body: Record<string, Doc[]> = {};
  for (const c of COLLECTIONS) body[c] = [{ ...samples[c]!, id: 'min' }, full[c]!];
  const r = await put(uid, body);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { upserted: 12 });
  const back = await get(uid);
  for (const c of COLLECTIONS) {
    assert.equal(back[c]!.length, 2, c);
    for (const doc of body[c]!) assert.deepEqual(back[c]!.find((x) => x.id === doc.id), doc, c);
  }
});

test('lists are ordered deterministically (createdAt then id; payments/moves by date then id)', async () => {
  const uid = newUid();
  await put(uid, {
    transactions: [tx({ id: 'b', createdAt: 2 }), tx({ id: 'a', createdAt: 2 }), tx({ id: 'z', createdAt: 1 }), tx({ id: 'n' })],
    payments: [
      { ...samples.payments, id: 'p2', date: '2026-01-02' }, { ...samples.payments, id: 'p1', date: '2026-01-02' },
      { ...samples.payments, id: 'p0', date: '2026-01-03' }, { ...samples.payments, id: 'pz', date: '2026-01-01' },
    ],
  });
  const d = await get(uid);
  assert.deepEqual(d.transactions!.map((x) => x.id), ['z', 'a', 'b', 'n']);
  assert.deepEqual(d.payments!.map((x) => x.id), ['pz', 'p1', 'p2', 'p0']);
});

test('replace semantics: fields not sent are cleared', async () => {
  const uid = newUid();
  await put(uid, { transactions: [full.transactions], cards: [full.cards] });
  const minimal = tx({ id: 'f1' });
  await put(uid, { transactions: [minimal], cards: [{ id: 'c1', name: 'Nubank', limit: 1, dueDay: 1 }] });
  const d = await get(uid);
  assert.deepEqual(d.transactions, [minimal]);
  assert.deepEqual(d.cards, [{ id: 'c1', name: 'Nubank', limit: 1, dueDay: 1 }]);
});

test('archive round trip: archive, restore, nothing is removed', async () => {
  const uid = newUid();
  for (const c of COLLECTIONS) {
    const item = { ...samples[c]!, id: 'a1' };
    await put(uid, { [c]: [item] });
    await put(uid, { [c]: [{ ...item, archivedAt: 1760000000000 }] });
    assert.equal((await get(uid))[c]![0]!.archivedAt, 1760000000000, c); // archived docs are still returned
    await put(uid, { [c]: [item] });
    assert.deepEqual((await get(uid))[c], [item], c);
    assert.equal((await put(uid, { [c]: [{ ...item, archivedAt: 'yesterday' }] })).statusCode, 400);
  }
});

test('validation failures return 400 with details, per collection, and write nothing', async () => {
  const uid = newUid();
  const cases: Record<string, Doc[]> = {
    transactions: [tx({ amount: 0 }), tx({ extra: 1 }), tx({ date: '30/10/2026' }), tx({ reserveId: 'r', cardId: 'c' }), tx({ description: 'x'.repeat(101) })],
    cards: [{ ...samples.cards!, dueDay: 40 }, { ...samples.cards!, color: 'roxo' }],
    payments: [{ ...samples.payments!, amount: -1 }, { ...samples.payments!, invoiceKey: '2026-1' }],
    reserves: [{ ...samples.reserves!, saldo: 1 }, { ...samples.reserves!, goal: 0 }],
    reserveMoves: [{ ...samples.reserveMoves!, type: 'transfer' }, { ...samples.reserveMoves!, confirmed: 'sim' }],
    categories: [{ ...samples.categories!, kind: 'income', weight: 0.5 }, { ...samples.categories!, name: 'n'.repeat(41) }],
  };
  for (const [c, docs] of Object.entries(cases)) {
    for (const doc of docs) {
      const r = await put(uid, { [c]: [doc] });
      assert.equal(r.statusCode, 400, `${c} ${JSON.stringify(doc)}`);
      const j = r.json();
      assert.equal(j.error, 'invalid');
      assert.equal(j.details[0].collection, c);
      assert.equal(j.details[0].id, doc.id);
      assert.ok(j.details[0].message.length > 3);
    }
  }
  assert.deepEqual(await get(uid), { transactions: [], cards: [], payments: [], reserves: [], reserveMoves: [], categories: [] });
});

test('invalid id, missing id and bad body shapes are rejected', async () => {
  const uid = newUid();
  for (const doc of [{ ...samples.cards!, id: 'a/b' }, { ...samples.cards!, id: '' }, { ...samples.cards!, id: 5 }, (({ id: _id, ...rest }) => rest)(samples.cards!)]) {
    assert.equal((await put(uid, { cards: [doc] })).statusCode, 400);
  }
  for (const body of [{ cards: {} }, { nope: [] }, [], 'x', { cards: [1] }, { cards: [null] }]) {
    assert.equal((await put(uid, body)).statusCode, 400, JSON.stringify(body));
  }
  const bad = await app.inject({ method: 'PUT', url: '/api/data', headers: { ...bearer(uid), 'content-type': 'application/json' }, payload: '{oops' });
  assert.equal(bad.statusCode, 400);
});

test('atomicity: one invalid doc writes nothing (also across collections)', async () => {
  const uid = newUid();
  const r = await put(uid, { cards: [{ ...samples.cards!, id: 'good' }], transactions: [tx({ id: 'ok' }), tx({ id: 'bad', amount: -1 })] });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().details.map((d: { id: string }) => d.id), ['bad']);
  assert.deepEqual(await get(uid), { transactions: [], cards: [], payments: [], reserves: [], reserveMoves: [], categories: [] });
});

test('atomicity: a database failure in the middle rolls everything back', async () => {
  const uid = newUid();
  // bypasses validation on purpose: the second card violates a CHECK constraint
  await assert.rejects(
    withTransaction(pool, (c) => upsertDocs(c, uid, { cards: [{ ...samples.cards!, id: 'good' }, { ...samples.cards!, id: 'boom', dueDay: 99 }] })),
  );
  assert.deepEqual((await get(uid)).cards, []);
});

test('limits: at most 500 documents, details capped at 20', async () => {
  const uid = newUid();
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: 'N', limit: 1, dueDay: 1 }));
  const r501 = await put(uid, { cards: many(501) });
  assert.equal(r501.statusCode, 400);
  assert.equal(r501.json().error, 'too_many_documents');
  assert.equal((await put(uid, { cards: many(500) })).json().upserted, 500);
  const r = await put(uid, { cards: many(50).map((c) => ({ ...c, dueDay: 99 })) });
  assert.equal(r.json().details.length, 20);
});

test('limits: body over 5 MB is rejected with 413', async () => {
  const r = await put(newUid(), { transactions: [tx({ description: 'x'.repeat(6 * 1024 * 1024) })] });
  assert.equal(r.statusCode, 413);
});

test('user isolation: same ids per user, nobody sees or touches another account', async () => {
  const a = newUid();
  const b = newUid();
  await put(a, { transactions: [tx({ id: 'same', description: 'A' })], cards: [{ ...samples.cards!, id: 'same' }] });
  await put(b, { transactions: [tx({ id: 'same', description: 'B' })] });
  assert.equal((await get(a)).transactions![0]!.description, 'A');
  assert.equal((await get(b)).transactions![0]!.description, 'B');
  assert.deepEqual((await get(b)).cards, []);
  // b replacing 'same' did not alter a
  await put(b, { transactions: [tx({ id: 'same', description: 'B2', archivedAt: 1 })] });
  assert.deepEqual((await get(a)).transactions, [tx({ id: 'same', description: 'A' })]);
  // a user id cannot be forged through the body
  assert.equal((await put(a, { transactions: [{ ...tx({ id: 'q' }), userId: b }] })).statusCode, 400);
  assert.deepEqual((await get(b)).transactions!.map((t) => t.id), ['same']);
});

test('405 for other verbs on /api/data, 404 for unknown routes', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
    const r = await app.inject({ method, url: '/api/data', headers: bearer(newUid()) });
    assert.equal(r.statusCode, 405, method);
  }
  for (const url of ['/api/nope', '/', '/api/data/t1', '/api']) {
    const r = await app.inject({ method: 'GET', url, headers: bearer(newUid()) });
    assert.equal(r.statusCode, 404, url);
  }
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/data/t1' })).statusCode, 404);
});
