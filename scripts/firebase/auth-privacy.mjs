// Email enumeration protection of Firebase Authentication (project setting).
//   npm run firebase:auth-privacy -- status   shows the current value
//   npm run firebase:auth-privacy -- off      lets the app ask whether an email already has an account
//   npm run firebase:auth-privacy -- on       turns the protection back on (the safe default)
// With the protection off, anyone can find out which emails are registered.
import { getAuth } from 'firebase-admin/auth';
import { admin } from './_admin.mjs';

const mode = process.argv[2] ?? 'status';
if (!['status', 'on', 'off'].includes(mode)) {
  console.error('Usage: npm run firebase:auth-privacy -- status|on|off');
  process.exit(1);
}
const { projectId } = admin();
const manager = getAuth().projectConfigManager();
if (mode !== 'status') {
  await manager.updateProjectConfig({ emailPrivacyConfig: { enableImprovedEmailPrivacy: mode === 'on' } });
}
const cfg = await manager.getProjectConfig();
console.log('project:', projectId);
console.log('email enumeration protection:', cfg.emailPrivacyConfig?.enableImprovedEmailPrivacy ? 'ON' : 'OFF');
