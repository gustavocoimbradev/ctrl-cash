import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createPool, readAll, type Pool } from '../db.js';
import { migrate } from '../migrate.js';
import { exportDb, importData, type ExportFile } from '../tools/import-export.js';
import { COLLECTIONS } from '../validate.js';
import { DATABASE_URL, full, newUid, samples } from './helpers.js';

let pool: Pool;
before(async () => {
  pool = createPool(DATABASE_URL);
  await migrate(pool);
});
after(() => pool.end());

test('migrations are idempotent and recorded', async () => {
  assert.deepEqual(await migrate(pool), []);
  assert.deepEqual(await migrate(pool), []);
  const r = await pool.query('select name from schema_migrations order by name');
  assert.deepEqual(r.rows.map((x) => x.name), ['001_init.sql', '002_social.sql', '003_profile_public_id.sql', '004_profile_photo.sql', '005_profile_code.sql', '006_settings.sql', '007_category_tone.sql', '008_shopping_lists.sql', '009_wishlist.sql', '010_assistant.sql', '011_assistant_write.sql']);
  // concurrent runs do not collide
  await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
});

const fileFor = (uid: string, extra: Record<string, unknown[]> = {}): ExportFile => ({
  exportedAt: new Date().toISOString(),
  projectId: 'p',
  users: { [uid]: { email: 'a@b.c', ...Object.fromEntries(COLLECTIONS.map((c) => [c, [full[c]]])), ...extra } },
});

test('import: dry run writes nothing, real run is idempotent, export-db returns the same data', async () => {
  const uid = newUid();
  const file = fileFor(uid);
  const dry = await importData(pool, file, { dryRun: true });
  assert.equal(dry.written, false);
  assert.equal(dry.counts[uid]!.transactions, 1);
  assert.deepEqual((await readAll(pool, uid)).transactions, []);

  const one = await importData(pool, file);
  assert.equal(one.written, true);
  const after1 = await readAll(pool, uid);
  await importData(pool, file);
  assert.deepEqual(await readAll(pool, uid), after1);

  const exported = await exportDb(pool);
  const mine = exported.users[uid]!;
  for (const c of COLLECTIONS) assert.deepEqual(mine[c], file.users[uid]![c], c);
});

test('import: a missing collection is fine; invalid docs block everything unless --skip-invalid', async () => {
  const uid = newUid();
  const bad = { ...samples.cards!, id: 'bad', dueDay: 99 };
  const file: ExportFile = { users: { [uid]: { cards: [samples.cards!, bad] } } };
  const blocked = await importData(pool, file);
  assert.equal(blocked.written, false);
  assert.deepEqual(blocked.invalid.map((i) => [i.uid, i.collection, i.id]), [[uid, 'cards', 'bad']]);
  assert.deepEqual((await readAll(pool, uid)).cards, []);
  const skipped = await importData(pool, file, { skipInvalid: true });
  assert.equal(skipped.written, true);
  assert.equal((await readAll(pool, uid)).cards.length, 1);
  await assert.rejects(importData(pool, {} as ExportFile));
});
