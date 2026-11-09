import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createPool, upsertDocs, withTransaction, readAll, type Pool } from '../db.js';
import { mappers } from '../mappers.js';
import { migrate } from '../migrate.js';
import { COLLECTIONS } from '../validate.js';
import { DATABASE_URL, full, newUid, samples } from './helpers.js';

let pool: Pool;
before(async () => {
  pool = createPool(DATABASE_URL);
  await migrate(pool);
});
after(() => pool.end());

test('mapper round trip in memory: doc -> row -> doc is identical', () => {
  for (const c of COLLECTIONS) {
    const m = mappers[c];
    for (const doc of [samples[c]!, full[c]!]) {
      // simulate pg: json columns come back parsed, numbers as bigint strings
      const row: Record<string, unknown> = {};
      m.fields.forEach((f, i) => {
        const v = m.toRow(doc)[i];
        row[f.col] = v === null ? null : f.kind === 'json' ? JSON.parse(v as string) : f.kind === 'int' ? String(v) : v;
      });
      assert.deepEqual(m.fromRow(row), doc, c);
    }
  }
});

test('mapper round trip through PostgreSQL (floats, big amounts, unicode)', async () => {
  const uid = newUid();
  const docs = {
    transactions: [{ ...full.transactions!, description: 'Café ☕ 日本語', amount: 100000000000 }],
    categories: [{ ...full.categories!, weight: 0.1 + 0.2 }],
    cards: [full.cards!], payments: [full.payments!], reserves: [full.reserves!], reserveMoves: [full.reserveMoves!], shoppingLists: [full.shoppingLists!],
  };
  await withTransaction(pool, (c) => upsertDocs(c, uid, docs));
  const back = await readAll(pool, uid);
  for (const c of COLLECTIONS) assert.deepEqual(back[c], docs[c], c);
});

test('database CHECK constraints mirror the rules (defense in depth)', async () => {
  const uid = newUid();
  const insert = (sql: string) => pool.query(sql.replace('$U', `'${uid}'`));
  await assert.rejects(insert(`insert into cards (user_id,id,name,credit_limit,due_day) values ($U,'a','n',0,5)`));
  await assert.rejects(insert(`insert into cards (user_id,id,name,credit_limit,due_day) values ($U,'a','n',5,32)`));
  await assert.rejects(insert(`insert into categories (user_id,id,slug,kind,name,weight) values ($U,'a','s','income','n',0.5)`));
  await assert.rejects(insert(`insert into categories (user_id,id,slug,kind,name,weight) values ($U,'a','s','expense','n',1.5)`));
  await assert.rejects(insert(`insert into reserve_moves (user_id,id,reserve_id,type,amount,date) values ($U,'a','r','x',5,'2026-01-01')`));
  await assert.rejects(insert(`insert into transactions (user_id,id,type,description,amount,date,confirmed,fixed,confirmed_months,card_id,reserve_id) values ($U,'a','expense','d',5,'2026-01-01',true,false,'{}','c','r')`));
});
