// Import a Firestore export into PostgreSQL, or dump the database back to the same format.
//   npm run import -- <file.json> [--dry-run] [--skip-invalid]
//   npm run export-db -- <out.json>
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPool, listUserIds, readAll, upsertDocs, withTransaction, type Docs, type Pool } from '../db.js';
import { COLLECTIONS, validate, type Collection, type Doc } from '../validate.js';

export interface ExportFile {
  exportedAt?: string;
  projectId?: string;
  users: Record<string, { email?: string } & Partial<Record<Collection, Doc[]>>>;
}

export interface ImportReport {
  counts: Record<string, Record<string, number>>; // uid -> collection -> valid docs
  invalid: { uid: string; collection: string; id: unknown; message: string }[];
  written: boolean;
}

export async function importData(pool: Pool, data: ExportFile, opts: { dryRun?: boolean; skipInvalid?: boolean } = {}): Promise<ImportReport> {
  if (typeof data !== 'object' || data === null || typeof data.users !== 'object' || data.users === null) {
    throw new Error('invalid file: "users" object is missing');
  }
  const counts: ImportReport['counts'] = {};
  const invalid: ImportReport['invalid'] = [];
  const perUser: Record<string, Docs> = {};

  for (const [uid, user] of Object.entries(data.users)) {
    if (!uid) throw new Error('invalid file: empty user id');
    counts[uid] = {};
    const docs: Docs = {};
    for (const c of COLLECTIONS) {
      const list = user[c];
      if (list === undefined) continue;
      if (!Array.isArray(list)) throw new Error(`invalid file: users.${uid}.${c} must be a list`);
      for (const doc of list) {
        const message = validate(c, doc);
        if (message) invalid.push({ uid, collection: c, id: (doc as Doc | null)?.id, message });
        else (docs[c] ??= []).push(doc);
      }
      counts[uid][c] = docs[c]?.length ?? 0;
    }
    perUser[uid] = docs;
  }

  const blocked = invalid.length > 0 && !opts.skipInvalid;
  if (opts.dryRun || blocked) return { counts, invalid, written: false };
  await withTransaction(pool, async (client) => {
    for (const [uid, docs] of Object.entries(perUser)) await upsertDocs(client, uid, docs);
  });
  return { counts, invalid, written: true };
}

export async function exportDb(pool: Pool): Promise<ExportFile> {
  const users: ExportFile['users'] = {};
  for (const uid of await listUserIds(pool)) users[uid] = await readAll(pool, uid);
  return { exportedAt: new Date().toISOString(), projectId: process.env.FIREBASE_PROJECT_ID, users };
}

async function main() {
  const [cmd, file, ...flags] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if ((cmd !== 'import' && cmd !== 'export') || !file) {
    throw new Error('usage: import <file.json> [--dry-run] [--skip-invalid] | export <out.json>');
  }
  const pool = createPool(url);
  try {
    if (cmd === 'export') {
      const out = await exportDb(pool);
      await writeFile(file, JSON.stringify(out, null, 2) + '\n');
      console.log(`exported ${Object.keys(out.users).length} user(s) to ${file}`);
      return;
    }
    const dryRun = flags.includes('--dry-run');
    const skipInvalid = flags.includes('--skip-invalid');
    const report = await importData(pool, JSON.parse(await readFile(file, 'utf8')) as ExportFile, { dryRun, skipInvalid });
    for (const [uid, c] of Object.entries(report.counts)) {
      console.log(`${uid}: ${Object.entries(c).map(([k, n]) => `${k}=${n}`).join(' ') || '(empty)'}`);
    }
    for (const i of report.invalid) console.error(`INVALID ${i.uid}/${i.collection}/${String(i.id)}: ${i.message}`);
    console.log(report.written ? 'import done' : dryRun ? 'dry run: nothing written' : 'nothing written (invalid documents; use --skip-invalid to import the rest)');
    if (report.invalid.length && !skipInvalid) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
