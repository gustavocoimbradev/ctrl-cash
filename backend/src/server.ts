import { buildApp } from './app.js';
import { createEmulatorVerifier, createFirebaseVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const config = loadConfig(); // throws (and the process exits) on a missing or forbidden setting
const pool = createPool(config.databaseUrl);

if (config.runMigrations) {
  const applied = await migrate(pool);
  console.log(JSON.stringify({ msg: 'migrations', applied }));
}

const app = await buildApp({
  pool,
  verify: config.emulator ? createEmulatorVerifier(config.projectId) : createFirebaseVerifier(config.projectId),
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
  publicUrl: config.publicUrl,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
if (config.emulator) app.log.warn('FIREBASE_AUTH_EMULATOR=1: tokens are NOT cryptographically verified (development only)');

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
