import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Verifier } from './auth.js';
import { readAll, upsertDocs, withTransaction, type Docs, type Pool } from './db.js';
import { registerAssistant } from './assistant.js';
import { registerMcp } from './mcp.js';
import { registerSettings } from './settings.js';
import { registerSocial } from './social.js';
import { COLLECTIONS, validate, type Doc } from './validate.js';

declare module 'fastify' {
  interface FastifyRequest {
    uid: string;
  }
}

export const MAX_DOCS = 500;
export const BODY_LIMIT = 5 * 1024 * 1024;

export interface AppOptions {
  pool: Pool;
  verify: Verifier;
  allowedOrigins?: string[];
  trustProxy?: boolean;
  /** the public address of the site (PUBLIC_URL), for the OAuth and MCP addresses */
  publicUrl?: string;
  rateLimitMax?: number;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: BODY_LIMIT,
    trustProxy: opts.trustProxy ?? false,
    // request bodies and headers (tokens) are never logged: pino's default req serializer
    // only keeps method, url, host and remote address
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  if (opts.allowedOrigins?.length) {
    await app.register(cors, { origin: opts.allowedOrigins, methods: ['GET', 'PUT', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] });
  }
  await app.register(rateLimit, {
    max: opts.rateLimitMax ?? 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, error: 'rate_limited' }),
  });

  app.setErrorHandler((rawErr, req, reply) => {
    const err = rawErr as Error;
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 413) return reply.code(413).send({ error: 'payload_too_large' });
    if (status === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (status >= 400 && status < 500) return reply.code(400).send({ error: 'bad_request' });
    req.log.error({ err: { message: err.message, code: (err as { code?: string }).code } }, 'request failed');
    return reply.code(500).send({ error: 'internal' });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.split('?')[0] === '/api/data') {
      return reply.code(405).header('Allow', 'GET, PUT').send({ error: 'method_not_allowed' });
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/health', async (_req, reply) => {
    try {
      await opts.pool.query('select 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  const authenticate = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (m?.[1]) {
      try {
        req.uid = (await opts.verify(m[1])).uid;
        return;
      } catch {
        // falls through to 401
      }
    }
    return reply.code(401).send({ error: 'unauthorized' });
  };

  // profiles, messages and the shared summary; code lookups and messages get a stricter limit (unless a test sets its own)
  registerSocial(app, { pool: opts.pool, strictMax: opts.rateLimitMax }, authenticate);

  registerSettings(app, opts.pool, authenticate);
  registerAssistant(app, { pool: opts.pool, publicUrl: opts.publicUrl, strictMax: opts.rateLimitMax }, authenticate);
  registerMcp(app, opts.pool, opts.publicUrl);

  app.route({
    method: 'GET',
    url: '/api/data',
    onRequest: authenticate,
    handler: async (req) => readAll(opts.pool, req.uid),
  });

  app.route({
    method: 'PUT',
    url: '/api/data',
    onRequest: authenticate,
    handler: async (req, reply) => {
      const body = req.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return reply.code(400).send({ error: 'bad_request' });
      const input = body as Record<string, unknown>;
      const details: { collection: string; id: unknown; message: string }[] = [];
      let total = 0;

      for (const key of Object.keys(input)) {
        if (!(COLLECTIONS as readonly string[]).includes(key)) {
          details.push({ collection: key, id: null, message: 'unknown collection' });
        }
      }
      for (const c of COLLECTIONS) {
        if (input[c] === undefined) continue;
        if (!Array.isArray(input[c])) {
          details.push({ collection: c, id: null, message: 'must be a list of documents' });
          continue;
        }
        total += (input[c] as unknown[]).length;
      }
      if (details.length) return reply.code(400).send({ error: 'invalid', details: details.slice(0, 20) });
      if (total > MAX_DOCS) return reply.code(400).send({ error: 'too_many_documents', max: MAX_DOCS });

      const docs: Docs = {};
      for (const c of COLLECTIONS) {
        for (const doc of (input[c] as unknown[] | undefined) ?? []) {
          const message = validate(c, doc);
          if (message) {
            const id = typeof doc === 'object' && doc !== null ? (doc as Doc).id : null;
            details.push({ collection: c, id: typeof id === 'string' ? id : null, message });
          } else {
            (docs[c] ??= []).push(doc as Doc);
          }
        }
      }
      if (details.length) return reply.code(400).send({ error: 'invalid', details: details.slice(0, 20) });

      const upserted = await withTransaction(opts.pool, (client) => upsertDocs(client, req.uid, docs));
      return { upserted };
    },
  });

  return app;
}
