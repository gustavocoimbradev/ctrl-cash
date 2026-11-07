export interface Config {
  databaseUrl: string;
  projectId: string;
  port: number;
  host: string;
  runMigrations: boolean;
  allowedOrigins: string[];
  emulator: boolean;
  production: boolean;
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  const production = env.NODE_ENV === 'production';
  const emulator = env.FIREBASE_AUTH_EMULATOR === '1';
  if (production && emulator) {
    throw new Error('FIREBASE_AUTH_EMULATOR=1 is forbidden when NODE_ENV=production');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT is invalid');
  return {
    databaseUrl,
    projectId,
    port,
    host: env.HOST || '0.0.0.0',
    runMigrations: env.RUN_MIGRATIONS === '1',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    emulator,
    production,
    trustProxy: env.TRUST_PROXY === '1',
  };
}
