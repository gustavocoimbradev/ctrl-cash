// Connecting an AI assistant (Claude) to a person's own data: OAuth 2.1 (authorization code + PKCE, public clients that
// register themselves), the person's connections and the snapshot of their finances the assistant reads.
// Codes and tokens are random and only their SHA-256 is stored. Revoking a connection stamps it; nothing is deleted.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db.js';

type Authn = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export const SCOPE = 'assistant:read';
const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 60 * 86_400_000;
export const SNAPSHOT_MAX = 400_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Buffer) => b.toString('base64url');
const random = (prefix: string) => `${prefix}${b64url(randomBytes(32))}`;
const str = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/** The public address of the site: PUBLIC_URL when set, else what the proxy says. */
export function publicUrlOf(req: FastifyRequest, configured?: string): string {
  if (configured) return configured.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]!.trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0]!.trim();
  return `${proto}://${host}`;
}

/** A redirect URI a client may register: https, or http on the loopback (desktop and development clients); no fragment. */
export function validRedirectUri(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

export interface AssistantOptions {
  pool: Pool;
  /** PUBLIC_URL, when configured */
  publicUrl?: string;
  strictMax?: number;
}

/** Looks a bearer access token up: its person and connection, or null when unknown, expired or revoked. */
export async function userOfAccessToken(pool: Pool, header: string | undefined): Promise<{ userId: string; connectionId: string; canWrite: boolean } | null> {
  const m = /^Bearer (\S+)$/.exec(header ?? '');
  if (!m?.[1]) return null;
  const res = await pool.query(
    `select c.user_id, c.id, c.can_write from oauth_tokens t join assistant_connections c on c.id = t.connection_id
      where t.token_hash = $1 and t.kind = 'access' and t.expires_at_ms > $2 and c.revoked_at_ms is null`,
    [sha256(m[1]), Date.now()],
  );
  const r = res.rows[0];
  if (!r) return null;
  await pool.query('update assistant_connections set last_used_ms = $2 where id = $1', [r.id, Date.now()]).catch(() => {});
  return { userId: r.user_id as string, connectionId: r.id as string, canWrite: r.can_write === true };
}

export function registerAssistant(app: FastifyInstance, opts: AssistantOptions, authenticate: Authn) {
  const { pool } = opts;
  const base = (req: FastifyRequest) => publicUrlOf(req, opts.publicUrl);
  const limit = (max: number) => ({ config: { rateLimit: { max: opts.strictMax ?? max, timeWindow: '1 minute' } } });
  const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');

  // the token endpoint receives application/x-www-form-urlencoded
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (e) {
      done(e as Error);
    }
  });

  // ---- discovery
  const resourceMetadata = (req: FastifyRequest) => ({
    resource: `${base(req)}/api/mcp`,
    authorization_servers: [base(req)],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'Ctrl+Cash',
  });
  app.get('/.well-known/oauth-protected-resource', async (req) => resourceMetadata(req));
  app.get('/.well-known/oauth-protected-resource/api/mcp', async (req) => resourceMetadata(req));
  app.get('/.well-known/oauth-authorization-server', async (req) => ({
    issuer: base(req),
    authorization_endpoint: `${base(req)}/api/oauth/authorize`,
    token_endpoint: `${base(req)}/api/oauth/token`,
    registration_endpoint: `${base(req)}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  }));

  // ---- dynamic client registration (RFC 7591): public clients, exact redirect URIs
  app.post('/api/oauth/register', limit(20), async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === 'string' && u.length <= 500 && validRedirectUri(u))) {
      return reply.code(400).send({ error: 'invalid_redirect_uri' });
    }
    const name = (str(b.client_name, 80) ?? 'AI assistant').replace(/[\u0000-\u001f]/g, '');
    const clientId = randomUUID();
    const now = Date.now();
    await pool.query('insert into oauth_clients (client_id, name, redirect_uris, created_at_ms) values ($1, $2, $3::jsonb, $4)', [clientId, name, JSON.stringify(uris), now]);
    return reply.code(201).send({
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(now / 1000),
    });
  });

  const clientOf = async (clientId: unknown, redirectUri: unknown) => {
    const id = str(clientId, 100);
    const uri = str(redirectUri, 500);
    if (!id || !uri) return null;
    const res = await pool.query('select client_id, name, redirect_uris from oauth_clients where client_id = $1', [id]);
    const r = res.rows[0];
    if (!r || !(r.redirect_uris as string[]).includes(uri)) return null;
    return { id: r.client_id as string, name: r.name as string, redirectUri: uri };
  };
  const withParams = (uri: string, params: Record<string, string | undefined>) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
  };

  // ---- the authorization request lands here (a browser navigation) and goes on to the app's consent page
  app.get('/api/oauth/authorize', limit(60), async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const client = await clientOf(q.client_id, q.redirect_uri);
    // never redirect to an address that was not registered
    if (!client) return reply.code(400).send({ error: 'invalid_request', message: 'unknown client or redirect_uri' });
    const state = str(q.state, 500) ?? undefined;
    if (q.response_type !== 'code') return reply.redirect(withParams(client.redirectUri, { error: 'unsupported_response_type', state }));
    const challenge = str(q.code_challenge, 128);
    if (!challenge || q.code_challenge_method !== 'S256') return reply.redirect(withParams(client.redirectUri, { error: 'invalid_request', error_description: 'PKCE S256 is required', state }));
    const consent = new URL(`${base(req)}/connect`);
    consent.searchParams.set('client_id', client.id);
    consent.searchParams.set('redirect_uri', client.redirectUri);
    consent.searchParams.set('code_challenge', challenge);
    if (state) consent.searchParams.set('state', state);
    return reply.redirect(consent.toString());
  });

  // what the consent page shows before the person decides
  app.get('/api/oauth/client', limit(60), async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const client = await clientOf(q.client_id, q.redirect_uri);
    if (!client) return reply.code(404).send({ error: 'not_found' });
    return { name: client.name };
  });

  // the person said yes (signed in with their own account): a connection and a one-time code
  app.route({
    method: 'POST',
    url: '/api/oauth/approve',
    onRequest: authenticate,
    handler: async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const client = await clientOf(b.client_id, b.redirect_uri);
      const challenge = str(b.code_challenge, 128);
      if (!client || !challenge) return reply.code(400).send({ error: 'invalid_request' });
      const state = str(b.state, 500) ?? undefined;
      const now = Date.now();
      const connectionId = randomUUID();
      const code = random('cccode_');
      const db = await pool.connect();
      try {
        await db.query('begin');
        // one live connection per assistant: the older one of the same client is revoked
        await db.query('update assistant_connections set revoked_at_ms = $3 where user_id = $1 and client_id = $2 and revoked_at_ms is null', [req.uid, client.id, now]);
        await db.query('insert into assistant_connections (id, user_id, client_id, client_name, created_at_ms, can_write) values ($1, $2, $3, $4, $5, $6)', [connectionId, req.uid, client.id, client.name, now, b.write === true]);
        await db.query('insert into oauth_codes (code_hash, connection_id, client_id, redirect_uri, code_challenge, expires_at_ms) values ($1, $2, $3, $4, $5, $6)', [sha256(code), connectionId, client.id, client.redirectUri, challenge, now + CODE_TTL_MS]);
        await db.query('commit');
      } catch (e) {
        await db.query('rollback').catch(() => {});
        throw e;
      } finally {
        db.release();
      }
      return { redirect: withParams(client.redirectUri, { code, state }) };
    },
  });

  app.route({
    method: 'POST',
    url: '/api/oauth/deny',
    onRequest: authenticate,
    handler: async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const client = await clientOf(b.client_id, b.redirect_uri);
      if (!client) return reply.code(400).send({ error: 'invalid_request' });
      return { redirect: withParams(client.redirectUri, { error: 'access_denied', state: str(b.state, 500) ?? undefined }) };
    },
  });

  // ---- tokens
  const oauthError = (reply: FastifyReply, error: string, status = 400) => noStore(reply).code(status).send({ error });
  const issue = async (connectionId: string) => {
    const access = random('ccat_');
    const refresh = random('ccrt_');
    const now = Date.now();
    await pool.query('insert into oauth_tokens (token_hash, kind, connection_id, expires_at_ms) values ($1, $2, $3, $4), ($5, $6, $3, $7)', [sha256(access), 'access', connectionId, now + ACCESS_TTL_MS, sha256(refresh), 'refresh', now + REFRESH_TTL_MS]);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: SCOPE };
  };

  app.post('/api/oauth/token', limit(60), async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const now = Date.now();
    if (b.grant_type === 'authorization_code') {
      const code = str(b.code);
      const verifier = str(b.code_verifier, 128);
      const clientId = str(b.client_id, 100);
      const redirectUri = str(b.redirect_uri, 500);
      if (!code || !verifier || !clientId || !redirectUri || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return oauthError(reply, 'invalid_request');
      // a code works once: it is marked used in the same statement that reads it
      const res = await pool.query(
        `update oauth_codes set used_at_ms = $2 where code_hash = $1 and used_at_ms is null and expires_at_ms > $2
         returning connection_id, client_id, redirect_uri, code_challenge`,
        [sha256(code), now],
      );
      const r = res.rows[0];
      if (!r || r.client_id !== clientId || r.redirect_uri !== redirectUri) return oauthError(reply, 'invalid_grant');
      const expected = Buffer.from(r.code_challenge as string);
      const given = Buffer.from(b64url(createHash('sha256').update(verifier).digest()));
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return oauthError(reply, 'invalid_grant');
      const live = await pool.query('select 1 from assistant_connections where id = $1 and revoked_at_ms is null', [r.connection_id]);
      if (!live.rowCount) return oauthError(reply, 'invalid_grant');
      return noStore(reply).send(await issue(r.connection_id as string));
    }
    if (b.grant_type === 'refresh_token') {
      const token = str(b.refresh_token);
      if (!token) return oauthError(reply, 'invalid_request');
      const found = await pool.query(`select connection_id, expires_at_ms, used_at_ms from oauth_tokens where token_hash = $1 and kind = 'refresh'`, [sha256(token)]);
      const r = found.rows[0];
      if (!r || Number(r.expires_at_ms) <= now) return oauthError(reply, 'invalid_grant');
      if (r.used_at_ms !== null) {
        // a refresh token that was already used shows up again: somebody holds a copy, so the connection is cut
        await pool.query('update assistant_connections set revoked_at_ms = $2 where id = $1 and revoked_at_ms is null', [r.connection_id, now]);
        return oauthError(reply, 'invalid_grant');
      }
      const used = await pool.query(`update oauth_tokens set used_at_ms = $2 where token_hash = $1 and used_at_ms is null`, [sha256(token), now]);
      const live = await pool.query('select 1 from assistant_connections where id = $1 and revoked_at_ms is null', [r.connection_id]);
      if (!used.rowCount || !live.rowCount) return oauthError(reply, 'invalid_grant');
      return noStore(reply).send(await issue(r.connection_id as string));
    }
    return oauthError(reply, 'unsupported_grant_type');
  });

  // ---- the person's connections and the snapshot (signed in with their own account)
  app.route({
    method: 'GET',
    url: '/api/assistant/connections',
    onRequest: authenticate,
    handler: async (req) => {
      const res = await pool.query('select id, client_name, created_at_ms, last_used_ms, can_write from assistant_connections where user_id = $1 and revoked_at_ms is null order by created_at_ms desc', [req.uid]);
      const snap = await pool.query('select updated_at_ms from assistant_snapshots where user_id = $1', [req.uid]);
      return {
        connections: res.rows.map((r) => ({ id: r.id as string, name: r.client_name as string, createdAt: Number(r.created_at_ms), lastUsedAt: r.last_used_ms === null ? null : Number(r.last_used_ms), canWrite: r.can_write === true })),
        snapshotAt: snap.rows[0] ? Number(snap.rows[0].updated_at_ms) : null,
        mcpUrl: `${base(req)}/api/mcp`,
      };
    },
  });

  app.route({
    method: 'POST',
    url: '/api/assistant/connections/revoke',
    onRequest: authenticate,
    handler: async (req, reply) => {
      const id = str((req.body as Record<string, unknown> | null)?.id, 100);
      if (!id) return reply.code(400).send({ error: 'invalid' });
      await pool.query('update assistant_connections set revoked_at_ms = $3 where id = $1 and user_id = $2 and revoked_at_ms is null', [id, req.uid, Date.now()]);
      return { ok: true };
    },
  });

  // what a connection may do: read only, or also add transactions
  app.route({
    method: 'POST',
    url: '/api/assistant/connections/permissions',
    onRequest: authenticate,
    handler: async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const id = str(b.id, 100);
      if (!id || typeof b.write !== 'boolean') return reply.code(400).send({ error: 'invalid' });
      const res = await pool.query('update assistant_connections set can_write = $3 where id = $1 and user_id = $2 and revoked_at_ms is null', [id, req.uid, b.write]);
      return res.rowCount ? { ok: true } : reply.code(404).send({ error: 'not_found' });
    },
  });

  app.route({
    method: 'PUT',
    url: '/api/assistant/snapshot',
    onRequest: authenticate,
    handler: async (req, reply) => {
      const body = req.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body) || (body as { version?: unknown }).version !== 1) return reply.code(400).send({ error: 'invalid' });
      const json = JSON.stringify(body);
      if (json.length > SNAPSHOT_MAX || json.includes('\\u0000')) return reply.code(400).send({ error: 'invalid' });
      // it is only kept while somebody is connected
      const live = await pool.query('select 1 from assistant_connections where user_id = $1 and revoked_at_ms is null limit 1', [req.uid]);
      if (!live.rowCount) return reply.code(409).send({ error: 'not_connected' });
      await pool.query(
        `insert into assistant_snapshots (user_id, snapshot, updated_at_ms) values ($1, $2::jsonb, $3)
         on conflict (user_id) do update set snapshot = excluded.snapshot, updated_at_ms = excluded.updated_at_ms`,
        [req.uid, json, Date.now()],
      );
      return { ok: true };
    },
  });
}
