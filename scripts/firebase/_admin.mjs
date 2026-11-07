// Initializes Firebase Admin with the service key, which lives OUTSIDE the repository.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';

export const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? join(homedir(), '.config', 'moneey', 'firebase-admin.json');

export function admin() {
  if (!existsSync(KEY_PATH)) {
    console.error(`Service key not found at ${KEY_PATH}.\nSet GOOGLE_APPLICATION_CREDENTIALS or copy the key to that path (chmod 600). Never commit it.`);
    process.exit(1);
  }
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(readFileSync(KEY_PATH, 'utf8'))) });
  return { projectId: JSON.parse(readFileSync(KEY_PATH, 'utf8')).project_id };
}
