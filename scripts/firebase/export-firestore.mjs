// Exports every account's data from Firestore to one JSON file, to import it into PostgreSQL:
//   npm run firebase:export -- [out.json]        (default: backups/firestore-export-<date>.json)
// Read only. The file holds REAL financial data: it stays in backups/ (git-ignored) and is created with mode 600.
// Format: { exportedAt, projectId, users: { "<uid>": { email, transactions, cards, payments, reserves, reserveMoves, categories } } }
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { admin } from './_admin.mjs';

const COLLECTIONS = ['transactions', 'cards', 'payments', 'reserves', 'reserveMoves', 'categories'];
const { projectId } = admin();
const db = getFirestore();

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const out = process.argv[2] ?? `backups/firestore-export-${stamp}.json`;

const users = {};
const counts = [];
for (const ref of await db.collection('users').listDocuments()) {
  const entry = {};
  try {
    entry.email = (await getAuth().getUser(ref.id)).email ?? null;
  } catch {
    entry.email = null;
  }
  const row = { uid: ref.id.slice(0, 6) + '…', email: entry.email ? entry.email.replace(/^(.).*(@.*)$/, '$1***$2') : '—' };
  for (const col of COLLECTIONS) {
    const snap = await ref.collection(col).get();
    entry[col] = snap.docs.map((d) => d.data());
    row[col] = snap.size;
  }
  users[ref.id] = entry;
  counts.push(row);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), projectId, users }, null, 2));
chmodSync(out, 0o600);
console.log(`Exported ${Object.keys(users).length} account(s) to ${out} (mode 600, git-ignored). Counts only, no values:`);
console.table(counts);
