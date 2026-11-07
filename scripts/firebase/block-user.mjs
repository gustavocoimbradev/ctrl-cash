// Blocks (or unblocks) an account: use against abuse. When blocked, the person cannot sign in
// or renew the session.
//   npm run firebase:block -- email@example.com            blocks
//   npm run firebase:block -- email@example.com --unblock  unblocks
import { getAuth } from 'firebase-admin/auth';
import { admin } from './_admin.mjs';

const [email, flag] = process.argv.slice(2);
if (!email || email.startsWith('--')) {
  console.error('Usage: npm run firebase:block -- <email> [--unblock]');
  process.exit(1);
}
admin();
try {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const block = flag !== '--unblock';
  await auth.updateUser(user.uid, { disabled: block });
  if (block) await auth.revokeRefreshTokens(user.uid);
  console.log(`${block ? 'Account blocked' : 'Account unblocked'}: ${email} (uid ${user.uid}).`);
} catch (e) {
  console.error(e.code === 'auth/user-not-found' ? `No account with the email ${email}.` : (e.code ?? e.message));
  process.exit(1);
}
