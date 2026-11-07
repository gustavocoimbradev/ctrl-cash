// Checks the admin key and Firebase Authentication (the only Firebase service the app uses now).
import { getAuth } from 'firebase-admin/auth';
import { admin } from './_admin.mjs';

const { projectId } = admin();
console.log('project:', projectId);
try {
  const users = await getAuth().listUsers(5);
  console.log('Auth OK. users:', users.users.map((u) => `${u.email ?? u.uid} (providers: ${u.providerData.map((p) => p.providerId).join(',') || 'none'})`));
} catch (e) {
  console.log('Auth ERROR:', e.code ?? e.message);
}
