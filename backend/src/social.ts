// Social routes: profiles, direct messages and the shared monthly summary.
// People find each other by a short public code (`code`); the Firebase user id (`req.uid`) stays inside this file and is
// never put in a response. There are no follows: chatting and sharing both start by typing the other person's code.
// Nothing is removed: revoking a share stamps revoked_at_ms, and messages stay.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { generateCode, normalizeCode } from './code.js';
import type { Pool } from './db.js';
import { ValidationError } from './validate.js';
import { parseCodeBody, parseMessage, parseProfile, parseSummary, type ProfileInput } from './validate-social.js';

type Authn = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
type Db = pg.Pool | pg.PoolClient;
export type Row = Record<string, any>;

export interface Person {
  code: string;
  displayName: string;
  color: string | null;
  /** a small JPEG data URL, or null */
  photo: string | null;
}

/** A public card. Built field by field so the internal user id can never leak. */
export const toPerson = (r: Row): Person => ({
  code: r.code,
  displayName: r.display_name,
  color: r.color ?? null,
  photo: r.photo ?? null,
});

export const CARD_COLUMNS = 'p.user_id, p.code, p.display_name, p.color, p.photo';

export async function profileByCode(db: Db, code: string): Promise<Row | null> {
  const res = await db.query(`select ${CARD_COLUMNS} from profiles p where p.code = $1`, [code]);
  return res.rows[0] ?? null;
}

export async function hasShare(db: Db, owner: string, viewer: string): Promise<boolean> {
  const res = await db.query('select 1 from summary_shares where owner_id = $1 and viewer_id = $2 and revoked_at_ms is null', [owner, viewer]);
  return (res.rowCount ?? 0) > 0;
}

const codeExists = async (db: Db, code: string) => ((await db.query('select 1 from profiles where code = $1', [code])).rowCount ?? 0) > 0;
const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';

/** Gives an existing profile that has no code yet (created before codes existed) its code, once. */
async function assignCode(pool: Pool, uid: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await generateCode({ exists: (c) => codeExists(pool, c) });
    try {
      const res = await pool.query('update profiles set code = $2 where user_id = $1 and code is null returning code', [uid, code]);
      if (res.rows[0]) return res.rows[0].code as string;
      // a parallel request assigned it first
      return (await pool.query('select code from profiles where user_id = $1', [uid])).rows[0].code as string;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error('could not assign a code');
}

/** My profile row, with its code assigned if it was still missing; null when I have none. */
export async function myProfile(pool: Pool, uid: string): Promise<Row | null> {
  const res = await pool.query('select user_id, code, display_name, color, photo, discoverable from profiles where user_id = $1', [uid]);
  const r = res.rows[0];
  if (!r) return null;
  if (r.code === null) r.code = await assignCode(pool, uid);
  return r;
}

/** Creates or updates my profile. The code is assigned once and never changes; the photo column is only touched when `p.photo` is given. */
export async function upsertProfile(pool: Pool, uid: string, p: ProfileInput): Promise<Person> {
  const photoGiven = p.photo !== undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = (await pool.query('select code from profiles where user_id = $1', [uid])).rows[0];
    const code = existing?.code ?? (await generateCode({ exists: (c) => codeExists(pool, c) }));
    try {
      const res = await pool.query(
        `insert into profiles (user_id, display_name, color, photo, code, created_at_ms, discoverable) values ($1, $2, $3, $4, $5, $7, coalesce($8::boolean, true))
         on conflict (user_id) do update set display_name = excluded.display_name, color = excluded.color,
           photo = case when $6::boolean then excluded.photo else profiles.photo end,
           discoverable = case when $8::boolean is not null then $8::boolean else profiles.discoverable end,
           code = coalesce(profiles.code, excluded.code), updated_at = now()
         returning code, display_name, color, photo, discoverable`,
        [uid, p.displayName, p.color, photoGiven ? p.photo : null, code, photoGiven, Date.now(), p.discoverable ?? null],
      );
      return { ...toPerson(res.rows[0]), discoverable: res.rows[0].discoverable === true } as Person;
    } catch (e) {
      // two requests picked the same free code at once: pick another
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error('could not create the profile');
}

export type ActionResult<T = object> = ({ kind: 'ok' } & T) | { kind: 'no_profile' } | { kind: 'not_found' } | { kind: 'self' };

/** Sends a message from `uid` to the person with this code (a profile of my own is required). */
export async function sendMessageTo(pool: Pool, uid: string, to: string, body: string): Promise<ActionResult<{ message: { id: string; mine: true; body: string; createdAt: number; readAt: null } }>> {
  if (!(await myProfile(pool, uid))) return { kind: 'no_profile' };
  const peer = await profileByCode(pool, to);
  if (!peer) return { kind: 'not_found' };
  if (peer.user_id === uid) return { kind: 'self' };
  const id = randomUUID();
  const createdAt = Date.now();
  await pool.query('insert into messages (id, sender_id, recipient_id, body, created_at_ms) values ($1, $2, $3, $4, $5)', [id, uid, peer.user_id, body, createdAt]);
  return { kind: 'ok', message: { id, mine: true, body, createdAt, readAt: null } };
}

/** Starts (or restarts) sharing my summary with the person with this code. */
export async function shareSummaryWith(pool: Pool, uid: string, code: string): Promise<ActionResult> {
  if (!(await myProfile(pool, uid))) return { kind: 'no_profile' };
  const target = await profileByCode(pool, code);
  if (!target) return { kind: 'not_found' };
  if (target.user_id === uid) return { kind: 'self' };
  await pool.query(
    `insert into summary_shares (owner_id, viewer_id, created_at_ms) values ($1, $2, $3)
     on conflict (owner_id, viewer_id) do update set
       created_at_ms = case when summary_shares.revoked_at_ms is not null then excluded.created_at_ms else summary_shares.created_at_ms end,
       revoked_at_ms = null`,
    [uid, target.user_id, Date.now()],
  );
  return { kind: 'ok' };
}

/** Stops sharing with this person: the share is stamped revoked, never deleted. */
export async function revokeSummaryShare(pool: Pool, uid: string, code: string): Promise<ActionResult> {
  const target = await profileByCode(pool, code);
  if (!target) return { kind: 'not_found' };
  await pool.query('update summary_shares set revoked_at_ms = $3 where owner_id = $1 and viewer_id = $2 and revoked_at_ms is null', [uid, target.user_id, Date.now()]);
  return { kind: 'ok' };
}

/** The people I share with (`given`) and the people who share with me (`received`). */
export async function listShares(db: Db, uid: string): Promise<{ given: Person[]; received: Person[] }> {
  const given = await db.query(
    `select ${CARD_COLUMNS} from profiles p
       join summary_shares s on s.viewer_id = p.user_id and s.owner_id = $1 and s.revoked_at_ms is null
      where p.code is not null order by s.created_at_ms desc, p.code`,
    [uid],
  );
  const received = await db.query(
    `select ${CARD_COLUMNS} from profiles p
       join summary_shares s on s.owner_id = p.user_id and s.viewer_id = $1 and s.revoked_at_ms is null
      where p.code is not null order by s.created_at_ms desc, p.code`,
    [uid],
  );
  return { given: given.rows.map(toPerson), received: received.rows.map(toPerson) };
}

/** The shared summary of the owner with this code, as seen by `uid`: null when not shared with them (or no such person). */
export async function sharedSummaryOf(db: Db, uid: string, code: string): Promise<{ owner: Person; summary: unknown; updatedAt: number | null } | null> {
  const owner = await profileByCode(db, code);
  if (!owner) return null;
  if (owner.user_id !== uid && !(await hasShare(db, owner.user_id, uid))) return null;
  const r = (await db.query('select summary, updated_at_ms from profile_summaries where user_id = $1', [owner.user_id])).rows[0];
  return { owner: toPerson(owner), summary: r ? r.summary : null, updatedAt: r ? Number(r.updated_at_ms) : null };
}

/** My conversations, newest first, with the last message and the unread count. */
export async function listConversations(db: Db, uid: string) {
  const res = await db.query(
    `with m as (
       select id, seq, body, created_at_ms, sender_id = $1 as mine,
              case when sender_id = $1 then recipient_id else sender_id end as peer
         from messages where sender_id = $1 or recipient_id = $1
     ), last as (
       select distinct on (peer) * from m order by peer, created_at_ms desc, seq desc
     )
     select ${CARD_COLUMNS}, l.id as last_id, l.mine as last_mine, l.body as last_body, l.created_at_ms as last_at,
            (select count(*)::int from messages x where x.recipient_id = $1 and x.sender_id = l.peer and x.read_at_ms is null) as unread
       from last l join profiles p on p.user_id = l.peer and p.code is not null
      order by l.created_at_ms desc, l.seq desc`,
    [uid],
  );
  return res.rows.map((r) => ({
    with: toPerson(r),
    last: { id: r.last_id as string, mine: r.last_mine as boolean, body: r.last_body as string, createdAt: Number(r.last_at) },
    unread: r.unread as number,
  }));
}

export const messageOut = (r: Row) => ({ id: r.id as string, mine: r.mine as boolean, body: r.body as string, createdAt: Number(r.created_at_ms), readAt: r.read_at_ms === null ? null : Number(r.read_at_ms) });

/** The last `limit` messages between me and this peer (oldest first). Does not mark anything as read. */
export async function recentMessages(db: Db, uid: string, peerId: string, limit: number) {
  const res = await db.query(
    `select * from (select id, seq, body, created_at_ms, read_at_ms, sender_id = $1 as mine from messages
       where ((sender_id = $1 and recipient_id = $2) or (sender_id = $2 and recipient_id = $1))
       order by created_at_ms desc, seq desc limit $3) t order by created_at_ms, seq`,
    [uid, peerId, limit],
  );
  return res.rows.map(messageOut);
}

export interface SocialOptions {
  pool: Pool;
  /** overrides the per-minute limit of the strict routes (tests); `undefined` keeps 20 for lookups and 30 for messages */
  strictMax?: number;
}

export function registerSocial(app: FastifyInstance, opts: SocialOptions, authenticate: Authn) {
  const { pool } = opts;
  const limit = (max: number) => ({ rateLimit: { max: opts.strictMax ?? max, timeWindow: '1 minute' } });
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ error: 'invalid', message });

  /** Wraps a handler so a ValidationError becomes a 400 with its message. */
  const route = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
    max?: number,
  ) =>
    app.route({
      method,
      url,
      onRequest: authenticate,
      ...(max ? { config: limit(max) } : {}),
      handler: async (req, reply) => {
        try {
          return await handler(req, reply);
        } catch (e) {
          if (e instanceof ValidationError) return bad(reply, e.message);
          throw e;
        }
      },
    });

  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const codeParam = (req: FastifyRequest) => normalizeCode((req.params as { code?: string }).code ?? '');

  // ---- profile
  route('GET', '/api/profile', async (req) => {
    const r = await myProfile(pool, req.uid);
    return { profile: r ? { ...toPerson(r), discoverable: r.discoverable === true } : null };
  });

  route('PUT', '/api/profile', async (req) => {
    const p = parseProfile(req.body);
    return { profile: await upsertProfile(pool, req.uid, p) };
  });

  // ---- the people list of the new-chat screen: people I already talk to or share with first, then everybody who can be found. Search
  // by name (part of it) or by code. Photos only come with the people I already know (the list stays light).
  route(
    'GET',
    '/api/people',
    async (req) => {
      const q = (req.query as { q?: unknown; offset?: unknown }).q;
      const text = typeof q === 'string' ? q.trim().slice(0, 40) : '';
      const offset = Math.min(Math.max(Number((req.query as { offset?: unknown }).offset) || 0, 0), 5000);
      const like = `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const PAGE = 20;
      // profiles made before codes existed get theirs now: without a code nobody can start a chat with them
      const missing = await pool.query('select user_id from profiles where code is null limit 100');
      for (const m of missing.rows) await assignCode(pool, m.user_id as string);
      const res = await pool.query(
        `with related as (
           select recipient_id as other from messages where sender_id = $1
           union select sender_id from messages where recipient_id = $1
           union select viewer_id from summary_shares where owner_id = $1 and revoked_at_ms is null
           union select owner_id from summary_shares where viewer_id = $1 and revoked_at_ms is null
         ), last_chat as (
           select other, max(at) as at from (
             select recipient_id as other, created_at_ms as at from messages where sender_id = $1
             union all select sender_id, created_at_ms from messages where recipient_id = $1
           ) m group by other
         )
         select p.code, p.display_name, p.color, case when r.other is not null then p.photo end as photo, (r.other is not null) as related
           from profiles p
           left join related r on r.other = p.user_id
           left join last_chat l on l.other = p.user_id
          where p.user_id <> $1 and p.code is not null
            and (r.other is not null or p.discoverable or ($2 <> '' and p.code = upper($2)))
            and ($2 = '' or p.display_name ilike $3 escape '\\' or p.code = upper($2))
          order by (r.other is not null) desc, l.at desc nulls last, lower(p.display_name), p.code
          limit ${PAGE + 1} offset $4`,
        [req.uid, text, like, offset],
      );
      const rows = res.rows.slice(0, PAGE);
      return {
        people: rows.map((r) => ({ code: r.code as string, displayName: r.display_name as string, color: (r.color as string | null) ?? null, photo: (r.photo as string | null) ?? null, related: r.related === true })),
        more: res.rows.length > PAGE,
      };
    },
    30,
  );

  // ---- look somebody up by code
  route(
    'GET',
    '/api/people/:code',
    async (req, reply) => {
      const code = codeParam(req);
      if (!code) return notFound(reply);
      const row = await profileByCode(pool, code);
      if (!row) return notFound(reply);
      const self = row.user_id === req.uid;
      return {
        person: {
          ...toPerson(row),
          self,
          summaryAccess: self || (await hasShare(pool, row.user_id, req.uid)),
          sharedWithThem: !self && (await hasShare(pool, req.uid, row.user_id)),
          sharesWithMe: !self && (await hasShare(pool, row.user_id, req.uid)),
        },
      };
    },
    20,
  );

  // ---- messages
  route('GET', '/api/conversations', async (req) => {
    return { conversations: await listConversations(pool, req.uid) };
  });


  route('GET', '/api/messages/:code', async (req, reply) => {
    const code = codeParam(req);
    if (!code) return notFound(reply);
    const peer = await profileByCode(pool, code);
    if (!peer) return notFound(reply);
    const raw = (req.query as { since?: unknown }).since;
    let since: number | null = null;
    if (raw !== undefined) {
      since = /^[0-9]{1,15}$/.test(String(raw)) ? Number(raw) : null;
      if (since === null) return bad(reply, '"since" must be a number of milliseconds');
    }
    const base = `select id, seq, body, created_at_ms, read_at_ms, sender_id = $1 as mine from messages
       where ((sender_id = $1 and recipient_id = $2) or (sender_id = $2 and recipient_id = $1))`;
    const res =
      since === null
        ? await pool.query(`select * from (${base} order by created_at_ms desc, seq desc limit 100) t order by created_at_ms, seq`, [req.uid, peer.user_id])
        : await pool.query(`${base} and created_at_ms > $3 order by created_at_ms, seq limit 200`, [req.uid, peer.user_id, since]);
    return { messages: res.rows.map(messageOut), canSend: true };
  });

  route(
    'POST',
    '/api/messages',
    async (req, reply) => {
      const m = parseMessage(req.body);
      const r = await sendMessageTo(pool, req.uid, m.to, m.body);
      if (r.kind === 'no_profile') return reply.code(403).send({ error: 'profile_required' });
      if (r.kind === 'not_found') return notFound(reply);
      if (r.kind === 'self') return bad(reply, 'you cannot message yourself');
      return reply.code(201).send({ message: r.message });
    },
    30,
  );

  route('POST', '/api/messages/read', async (req, reply) => {
    const peer = await profileByCode(pool, parseCodeBody(req.body));
    if (!peer) return notFound(reply);
    await pool.query(
      'update messages set read_at_ms = $3 where recipient_id = $1 and sender_id = $2 and read_at_ms is null',
      [req.uid, peer.user_id, Date.now()],
    );
    return { ok: true };
  });

  route('GET', '/api/unread', async (req) => {
    const res = await pool.query('select count(*)::int as n from messages where recipient_id = $1 and read_at_ms is null', [req.uid]);
    return { unread: res.rows[0].n };
  });

  // ---- shared summary
  route('GET', '/api/shares', async (req) => {
    return await listShares(pool, req.uid);
  });

  route('POST', '/api/shares', async (req, reply) => {
    const code = parseCodeBody(req.body);
    const r = await shareSummaryWith(pool, req.uid, code);
    if (r.kind === 'no_profile') return reply.code(403).send({ error: 'profile_required' });
    if (r.kind === 'not_found') return notFound(reply);
    if (r.kind === 'self') return bad(reply, 'you cannot share with yourself');
    return { ok: true };
  });

  route('POST', '/api/shares/revoke', async (req, reply) => {
    if ((await revokeSummaryShare(pool, req.uid, parseCodeBody(req.body))).kind === 'not_found') return notFound(reply);
    return { ok: true };
  });

  route('PUT', '/api/summary', async (req) => {
    const summary = parseSummary(req.body);
    await pool.query(
      `insert into profile_summaries (user_id, summary, updated_at_ms) values ($1, $2::jsonb, $3)
       on conflict (user_id) do update set summary = excluded.summary, updated_at_ms = excluded.updated_at_ms`,
      [req.uid, JSON.stringify(summary), Date.now()],
    );
    return { ok: true };
  });

  route('GET', '/api/people/:code/summary', async (req, reply) => {
    const denied = () => reply.code(403).send({ error: 'not_shared' });
    const code = codeParam(req);
    if (!code) return denied();
    const r = await sharedSummaryOf(pool, req.uid, code);
    if (!r) return denied();
    return { summary: r.summary, updatedAt: r.updatedAt };
  });
}
