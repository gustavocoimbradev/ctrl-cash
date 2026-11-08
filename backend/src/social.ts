// Social routes: profiles, follows, direct messages and the shared monthly summary.
// People are addressed by handle. The Firebase user id (`req.uid`) stays inside this file and is never put in a response.
// Nothing is removed: unfollow archives the follow, revoking a share stamps revoked_at_ms, messages stay.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTransaction, type Pool } from './db.js';
import { ValidationError } from './validate.js';
import { HANDLE_RE, parseHandle, parseHandleBody, parseMessage, parseProfile, parseSummary } from './validate-social.js';

type Authn = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
type Db = pg.Pool | pg.PoolClient;
type Row = Record<string, any>;

interface Person {
  handle: string;
  displayName: string;
  bio: string | null;
  color: string | null;
  relation: { following: boolean; followsMe: boolean; mutual: boolean };
}

/** A public card. Built field by field so the internal user id can never leak. */
const toPerson = (r: Row): Person => ({
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio ?? null,
  color: r.color ?? null,
  relation: { following: !!r.following, followsMe: !!r.follows_me, mutual: !!r.following && !!r.follows_me },
});

/** Profile columns plus how `$1` (the caller) and the person follow each other. Callers append joins and filters. */
const CARD_COLUMNS = `p.user_id, p.handle, p.display_name, p.bio, p.color,
  exists (select 1 from follows f where f.follower_id = $1 and f.followee_id = p.user_id and f.archived_at_ms is null) as following,
  exists (select 1 from follows f where f.follower_id = p.user_id and f.followee_id = $1 and f.archived_at_ms is null) as follows_me`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

async function profileByHandle(db: Db, handle: string): Promise<Row | null> {
  const res = await db.query('select user_id, handle, display_name, bio, color from profiles where handle = $1', [handle]);
  return res.rows[0] ?? null;
}

async function hasProfile(db: Db, uid: string): Promise<boolean> {
  return ((await db.query('select 1 from profiles where user_id = $1', [uid])).rowCount ?? 0) > 0;
}

/** Both follow each other (active follows). */
async function isMutual(db: Db, a: string, b: string): Promise<boolean> {
  const res = await db.query(
    `select count(*)::int as c from follows
      where archived_at_ms is null and ((follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1))`,
    [a, b],
  );
  return res.rows[0].c === 2;
}

async function hasShare(db: Db, owner: string, viewer: string): Promise<boolean> {
  const res = await db.query('select 1 from summary_shares where owner_id = $1 and viewer_id = $2 and revoked_at_ms is null', [owner, viewer]);
  return (res.rowCount ?? 0) > 0;
}

async function counts(db: Db, uid: string): Promise<{ followers: number; following: number }> {
  const res = await db.query(
    `select (select count(*)::int from follows where followee_id = $1 and archived_at_ms is null) as followers,
            (select count(*)::int from follows where follower_id = $1 and archived_at_ms is null) as following`,
    [uid],
  );
  return res.rows[0];
}

export interface SocialOptions {
  pool: Pool;
  /** per-minute limit of the chatty routes (messages, search); `undefined` keeps the default of 30 */
  strictMax?: number;
}

export function registerSocial(app: FastifyInstance, opts: SocialOptions, authenticate: Authn) {
  const { pool } = opts;
  const strict = { rateLimit: { max: opts.strictMax ?? 30, timeWindow: '1 minute' } };
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ error: 'invalid', message });

  /** Wraps a handler so a ValidationError becomes a 400 with its message. */
  const route = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
    limited = false,
  ) =>
    app.route({
      method,
      url,
      onRequest: authenticate,
      ...(limited ? { config: strict } : {}),
      handler: async (req, reply) => {
        try {
          return await handler(req, reply);
        } catch (e) {
          if (e instanceof ValidationError) return bad(reply, e.message);
          throw e;
        }
      },
    });

  /** Writes need a profile of your own: deny by default. */
  const needProfile = async (req: FastifyRequest, reply: FastifyReply) => {
    if (await hasProfile(pool, req.uid)) return true;
    reply.code(403).send({ error: 'profile_required' });
    return false;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const handleParam = (req: FastifyRequest) => String((req.params as { handle?: string }).handle ?? '').toLowerCase();

  // ---- profile
  route('GET', '/api/profile', async (req) => {
    const res = await pool.query('select handle, display_name, bio, color from profiles where user_id = $1', [req.uid]);
    const r = res.rows[0];
    const c = await counts(pool, req.uid);
    return {
      profile: r ? { handle: r.handle, displayName: r.display_name, bio: r.bio ?? null, color: r.color ?? null } : null,
      followers: c.followers,
      following: c.following,
    };
  });

  route('PUT', '/api/profile', async (req, reply) => {
    const p = parseProfile(req.body);
    try {
      const res = await pool.query(
        `insert into profiles (user_id, handle, display_name, bio, color, created_at_ms) values ($1, $2, $3, $4, $5, $6)
         on conflict (user_id) do update set handle = excluded.handle, display_name = excluded.display_name,
           bio = excluded.bio, color = excluded.color, updated_at = now()
         returning handle, display_name, bio, color`,
        [req.uid, p.handle, p.displayName, p.bio, p.color, Date.now()],
      );
      const r = res.rows[0];
      return { profile: { handle: r.handle, displayName: r.display_name, bio: r.bio ?? null, color: r.color ?? null } };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'handle_taken' });
      throw e;
    }
  });

  // ---- people
  route(
    'GET',
    '/api/people',
    async (req) => {
      const q = String((req.query as { q?: unknown }).q ?? '').trim().toLowerCase();
      if ([...q].length < 2 || [...q].length > 40 || q.includes('\u0000')) return { people: [] };
      const like = escapeLike(q);
      const res = await pool.query(
        `select ${CARD_COLUMNS} from profiles p
          where p.user_id <> $1 and (p.handle like $2 escape '\\' or p.display_name ilike $3 escape '\\')
          order by (p.handle like $2 escape '\\') desc, p.handle limit 20`,
        [req.uid, `${like}%`, `%${like}%`],
      );
      return { people: res.rows.map(toPerson) };
    },
    true,
  );

  route('GET', '/api/people/:handle', async (req, reply) => {
    const handle = handleParam(req);
    if (!HANDLE_RE.test(handle)) return notFound(reply);
    const res = await pool.query(`select ${CARD_COLUMNS} from profiles p where p.handle = $2`, [req.uid, handle]);
    const row = res.rows[0];
    if (!row) return notFound(reply);
    const self = row.user_id === req.uid;
    const c = await counts(pool, row.user_id);
    const card = self ? { ...toPerson({ ...row, following: false, follows_me: false }) } : toPerson(row);
    const mutual = !self && card.relation.mutual;
    return {
      person: {
        ...card,
        followers: c.followers,
        following: c.following,
        self,
        summaryAccess: self || (mutual && (await hasShare(pool, row.user_id, req.uid))),
        sharedWithThem: !self && mutual && (await hasShare(pool, req.uid, row.user_id)),
      },
    };
  });

  // ---- follows
  route('POST', '/api/follow', async (req, reply) => {
    const handle = parseHandleBody(req.body);
    if (!(await needProfile(req, reply))) return reply;
    const target = await profileByHandle(pool, handle);
    if (!target) return notFound(reply);
    if (target.user_id === req.uid) return bad(reply, 'you cannot follow yourself');
    const now = Date.now();
    await pool.query(
      `insert into follows (follower_id, followee_id, created_at_ms) values ($1, $2, $3)
       on conflict (follower_id, followee_id) do update set
         created_at_ms = case when follows.archived_at_ms is not null then excluded.created_at_ms else follows.created_at_ms end,
         archived_at_ms = null`,
      [req.uid, target.user_id, now],
    );
    return { ok: true };
  });

  route('POST', '/api/unfollow', async (req, reply) => {
    const handle = parseHandleBody(req.body);
    const target = await profileByHandle(pool, handle);
    if (!target) return notFound(reply);
    const now = Date.now();
    await withTransaction(pool, async (client) => {
      await client.query(
        'update follows set archived_at_ms = $3 where follower_id = $1 and followee_id = $2 and archived_at_ms is null',
        [req.uid, target.user_id, now],
      );
      // no longer connected: any summary share between the two stops, in both directions
      await client.query(
        `update summary_shares set revoked_at_ms = $3 where revoked_at_ms is null
           and ((owner_id = $1 and viewer_id = $2) or (owner_id = $2 and viewer_id = $1))`,
        [req.uid, target.user_id, now],
      );
    });
    return { ok: true };
  });

  route('GET', '/api/follows', async (req) => {
    const following = await pool.query(
      `select ${CARD_COLUMNS} from profiles p
         join follows ff on ff.followee_id = p.user_id and ff.follower_id = $1 and ff.archived_at_ms is null
        order by ff.created_at_ms desc, p.handle`,
      [req.uid],
    );
    const followers = await pool.query(
      `select ${CARD_COLUMNS} from profiles p
         join follows ff on ff.follower_id = p.user_id and ff.followee_id = $1 and ff.archived_at_ms is null
        order by ff.created_at_ms desc, p.handle`,
      [req.uid],
    );
    return { following: following.rows.map(toPerson), followers: followers.rows.map(toPerson) };
  });

  // ---- messages
  route('GET', '/api/conversations', async (req) => {
    const res = await pool.query(
      `with m as (
         select id, seq, body, created_at_ms, sender_id = $1 as mine,
                case when sender_id = $1 then recipient_id else sender_id end as peer
           from messages where sender_id = $1 or recipient_id = $1
       ), last as (
         select distinct on (peer) * from m order by peer, created_at_ms desc, seq desc
       )
       select ${CARD_COLUMNS}, l.id as last_id, l.mine as last_mine, l.body as last_body, l.created_at_ms as last_at, l.seq as last_seq,
              (select count(*)::int from messages x where x.recipient_id = $1 and x.sender_id = l.peer and x.read_at_ms is null) as unread
         from last l join profiles p on p.user_id = l.peer
        order by l.created_at_ms desc, l.seq desc`,
      [req.uid],
    );
    return {
      conversations: res.rows.map((r) => ({
        with: toPerson(r),
        last: { id: r.last_id, mine: r.last_mine, body: r.last_body, createdAt: Number(r.last_at) },
        unread: r.unread,
      })),
    };
  });

  const messageOut = (r: Row) => ({ id: r.id, mine: r.mine, body: r.body, createdAt: Number(r.created_at_ms), readAt: r.read_at_ms === null ? null : Number(r.read_at_ms) });

  route('GET', '/api/messages/:handle', async (req, reply) => {
    const handle = handleParam(req);
    if (!HANDLE_RE.test(handle)) return notFound(reply);
    const peer = await profileByHandle(pool, handle);
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
    return { messages: res.rows.map(messageOut), canSend: await isMutual(pool, req.uid, peer.user_id) };
  });

  app.route({
    method: 'POST',
    url: '/api/messages',
    onRequest: authenticate,
    config: strict,
    handler: async (req, reply) => {
      try {
        const m = parseMessage(req.body);
        if (!(await needProfile(req, reply))) return reply;
        const peer = await profileByHandle(pool, m.to);
        if (!peer) return notFound(reply);
        if (peer.user_id === req.uid) return bad(reply, 'you cannot message yourself');
        if (!(await isMutual(pool, req.uid, peer.user_id))) return reply.code(403).send({ error: 'not_mutual' });
        const id = randomUUID();
        const createdAt = Date.now();
        await pool.query('insert into messages (id, sender_id, recipient_id, body, created_at_ms) values ($1, $2, $3, $4, $5)', [id, req.uid, peer.user_id, m.body, createdAt]);
        return reply.code(201).send({ message: { id, mine: true, body: m.body, createdAt, readAt: null } });
      } catch (e) {
        if (e instanceof ValidationError) return bad(reply, e.message);
        throw e;
      }
    },
  });

  route('POST', '/api/messages/read', async (req, reply) => {
    const peer = await profileByHandle(pool, parseHandleBody(req.body));
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
    // only while the two still follow each other
    const given = await pool.query(
      `select * from (select ${CARD_COLUMNS}, s.created_at_ms as ord from profiles p
         join summary_shares s on s.viewer_id = p.user_id and s.owner_id = $1 and s.revoked_at_ms is null) t
        where t.following and t.follows_me order by t.ord desc, t.handle`,
      [req.uid],
    );
    const received = await pool.query(
      `select * from (select ${CARD_COLUMNS}, s.created_at_ms as ord from profiles p
         join summary_shares s on s.owner_id = p.user_id and s.viewer_id = $1 and s.revoked_at_ms is null) t
        where t.following and t.follows_me order by t.ord desc, t.handle`,
      [req.uid],
    );
    return { given: given.rows.map(toPerson), received: received.rows.map(toPerson) };
  });

  route('POST', '/api/shares', async (req, reply) => {
    const handle = parseHandleBody(req.body);
    if (!(await needProfile(req, reply))) return reply;
    const target = await profileByHandle(pool, handle);
    if (!target) return notFound(reply);
    if (target.user_id === req.uid) return bad(reply, 'you cannot share with yourself');
    if (!(await isMutual(pool, req.uid, target.user_id))) return reply.code(403).send({ error: 'not_mutual' });
    await pool.query(
      `insert into summary_shares (owner_id, viewer_id, created_at_ms) values ($1, $2, $3)
       on conflict (owner_id, viewer_id) do update set
         created_at_ms = case when summary_shares.revoked_at_ms is not null then excluded.created_at_ms else summary_shares.created_at_ms end,
         revoked_at_ms = null`,
      [req.uid, target.user_id, Date.now()],
    );
    return { ok: true };
  });

  route('POST', '/api/shares/revoke', async (req, reply) => {
    const target = await profileByHandle(pool, parseHandleBody(req.body));
    if (!target) return notFound(reply);
    await pool.query(
      'update summary_shares set revoked_at_ms = $3 where owner_id = $1 and viewer_id = $2 and revoked_at_ms is null',
      [req.uid, target.user_id, Date.now()],
    );
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

  route('GET', '/api/people/:handle/summary', async (req, reply) => {
    const denied = () => reply.code(403).send({ error: 'not_shared' });
    const handle = handleParam(req);
    if (!HANDLE_RE.test(handle)) return denied();
    const owner = await profileByHandle(pool, parseHandle(handle));
    if (!owner) return denied();
    if (owner.user_id !== req.uid) {
      // an active share from them to me AND both still following each other
      if (!(await hasShare(pool, owner.user_id, req.uid)) || !(await isMutual(pool, owner.user_id, req.uid))) return denied();
    }
    const res = await pool.query('select summary, updated_at_ms from profile_summaries where user_id = $1', [owner.user_id]);
    const r = res.rows[0];
    return r ? { summary: r.summary, updatedAt: Number(r.updated_at_ms) } : { summary: null, updatedAt: null };
  });
}
