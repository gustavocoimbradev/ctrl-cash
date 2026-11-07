import pg from 'pg';
import { mappers } from './mappers.js';
import { COLLECTIONS, type Collection, type Doc } from './validate.js';

// dates come back as 'YYYY-MM-DD' strings, never as JS Dates (timezone-proof)
pg.types.setTypeParser(1082, (v) => v);

export type Pool = pg.Pool;
export type Docs = Partial<Record<Collection, Doc[]>>;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function readAll(db: pg.Pool | pg.PoolClient, uid: string): Promise<Record<Collection, Doc[]>> {
  const out = {} as Record<Collection, Doc[]>;
  for (const c of COLLECTIONS) {
    const m = mappers[c];
    // table and order are constants from mappers.ts, never user input
    const res = await db.query(`select * from ${m.table} where user_id = $1 order by ${m.order}`, [uid]);
    out[c] = res.rows.map((r) => m.fromRow(r));
  }
  return out;
}

/** Create-or-replace by id. Must run inside a transaction opened by the caller. Returns the count. */
export async function upsertDocs(client: pg.PoolClient, uid: string, docs: Docs): Promise<number> {
  let n = 0;
  for (const c of COLLECTIONS) {
    const m = mappers[c];
    const cols = m.fields.map((x) => x.col);
    const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ');
    const updates = cols.filter((x) => x !== 'id').map((x) => `${x} = excluded.${x}`).concat('updated_at = now()');
    const sql = `insert into ${m.table} (user_id, ${cols.join(', ')}) values (${placeholders})
      on conflict (user_id, id) do update set ${updates.join(', ')}`;
    for (const doc of docs[c] ?? []) {
      await client.query(sql, [uid, ...m.toRow(doc)]);
      n++;
    }
  }
  return n;
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function listUserIds(pool: pg.Pool): Promise<string[]> {
  const sql = Object.values(mappers).map((m) => `select user_id from ${m.table}`).join(' union ');
  const res = await pool.query(`${sql} order by user_id`);
  return res.rows.map((r) => r.user_id as string);
}
