import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Pool } from '../db.js';
import { bearer, newUid, setup, tx } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
before(async () => ({ app, pool } = await setup()));
after(async () => {
  await app.close();
  await pool.end();
});

/** every uid used in a test, to prove none of them ever shows up in a response */
const seenUids = new Set<string>();
const user = () => {
  const uid = newUid();
  seenUids.add(uid);
  return uid;
};
/** a well-formed public id that belongs to nobody */
const NOBODY = '00000000-0000-4000-8000-000000000000';

async function call(uid: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  const r = await app.inject({ method, url, headers: bearer(uid), payload: payload as object | undefined });
  const text = r.body;
  for (const u of seenUids) assert.ok(!text.includes(u), `${method} ${url} leaked a user id`);
  return { status: r.statusCode, body: (text ? JSON.parse(text) : null) as any };
}

async function person(name = 'Ana') {
  const uid = user();
  const r = await call(uid, 'PUT', '/api/profile', { displayName: name });
  assert.equal(r.status, 200);
  return { uid, id: r.body.profile.id as string };
}
const follow = (a: { uid: string }, b: { id: string }) => call(a.uid, 'POST', '/api/follow', { id: b.id });
async function friends(name1 = 'Ana', name2 = 'Bob') {
  const a = await person(name1);
  const b = await person(name2);
  assert.equal((await follow(a, b)).status, 200);
  assert.equal((await follow(b, a)).status, 200);
  return { a, b };
}

const summary = (over: Record<string, unknown> = {}) => ({
  version: 2,
  generatedAt: 1790000000000,
  spent: 62.5,
  saved: 37.5,
  months: [
    { key: '2026-10', spent: 60, saved: 40, categories: [{ slug: 'groceries', label: 'Groceries', pct: 24.25 }] },
    { key: '2026-11', spent: 110.5, saved: -10.5, categories: [] },
  ],
  categories: [{ slug: 'groceries', label: 'Groceries', pct: 24.25 }, { slug: 'bills', label: 'Bills', pct: 38.125 }],
  ...over,
});

test('every social route needs a token', async () => {
  const routes: [string, string][] = [
    ['GET', '/api/profile'], ['PUT', '/api/profile'], ['GET', '/api/people?q=ab'], ['GET', '/api/people/abc'],
    ['POST', '/api/follow'], ['POST', '/api/unfollow'], ['GET', '/api/follows'], ['GET', '/api/conversations'],
    ['GET', '/api/messages/abc'], ['POST', '/api/messages'], ['POST', '/api/messages/read'], ['GET', '/api/unread'],
    ['GET', '/api/shares'], ['POST', '/api/shares'], ['POST', '/api/shares/revoke'], ['PUT', '/api/summary'], ['GET', '/api/people/abc/summary'],
  ];
  for (const [method, url] of routes) {
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const r = await app.inject({ method: method as 'GET', url, headers, payload: method === 'GET' ? undefined : {} });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
      assert.deepEqual(r.json(), { error: 'unauthorized' });
    }
  }
});

test('profile: empty, create, update, read back and validation', async () => {
  const uid = user();
  assert.deepEqual((await call(uid, 'GET', '/api/profile')).body, { profile: null, followers: 0, following: 0 });
  const created = await call(uid, 'PUT', '/api/profile', { displayName: '  Ana Lima ', color: '#2D55D9' });
  assert.equal(created.status, 200);
  const id = created.body.profile.id as string;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(created.body.profile, { id, displayName: 'Ana Lima', color: '#2D55D9' });
  const again = await call(uid, 'PUT', '/api/profile', { displayName: 'Ana' });
  assert.deepEqual(again.body.profile, { id, displayName: 'Ana', color: null });
  assert.deepEqual((await call(uid, 'GET', '/api/profile')).body.profile, { id, displayName: 'Ana', color: null });

  for (const bad of [
    {}, { displayName: '' }, { displayName: '   ' }, { displayName: 'x'.repeat(41) }, { displayName: 'x', color: 'red' },
    { displayName: 'x', extra: 1 }, { displayName: 'x', handle: 'ana_lima' }, { displayName: 'x', bio: 'hello' },
    { displayName: 'x\u0000y' }, { displayName: 5 },
  ]) {
    const r = await call(uid, 'PUT', '/api/profile', bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'invalid');
  }
  assert.equal((await call(uid, 'PUT', '/api/profile', [1])).status, 400);
});

test('profile: the public id is stable across edits, is not the Firebase uid, and two people can share a name', async () => {
  const a = await person('Same Name');
  const b = await person('Same Name');
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, a.uid);
  for (let i = 0; i < 3; i++) await call(a.uid, 'PUT', '/api/profile', { displayName: `Renamed ${i}`, color: '#000000' });
  assert.equal((await call(a.uid, 'GET', '/api/profile')).body.profile.id, a.id);
  // the old columns are never written
  const row = (await pool.query('select handle, bio from profiles where user_id = $1', [a.uid])).rows[0];
  assert.deepEqual(row, { handle: null, bio: null });
});

test('ids in paths and bodies must be uuids', async () => {
  const a = await person();
  for (const bad of ['abc', 'not-a-uuid', '12345678-1234-1234-1234-12345678901', '00000000-0000-4000-8000-00000000000g', `${a.id}x`, '%20']) {
    assert.equal((await call(a.uid, 'GET', `/api/people/${bad}`)).status, 404, bad);
    assert.equal((await call(a.uid, 'GET', `/api/messages/${bad}`)).status, 404, bad);
    assert.equal((await call(a.uid, 'GET', `/api/people/${bad}/summary`)).status, 403, bad);
  }
  for (const bad of [{ id: 'abc' }, { id: 5 }, {}, { handle: 'someone' }, { id: NOBODY, extra: 1 }]) {
    for (const url of ['/api/follow', '/api/unfollow', '/api/messages/read', '/api/shares', '/api/shares/revoke']) {
      assert.equal((await call(a.uid, 'POST', url, bad)).status, 400, `${url} ${JSON.stringify(bad)}`);
    }
  }
  assert.equal((await call(a.uid, 'POST', '/api/messages', { to: 'abc', body: 'x' })).status, 400);
  // upper-case ids are accepted and mean the same person
  assert.equal((await call(a.uid, 'GET', `/api/people/${a.id.toUpperCase()}`)).body.person.self, true);
});

test('search: by name only, needs 2 characters, excludes me, escapes wildcards', async () => {
  const tag = `zq${Date.now().toString(36)}`.slice(0, 12);
  const me = await person(`Seeker ${tag}`);
  const p1 = await person(`Maria ${tag} Silva`);
  const p2 = await person(`${tag} Joao`);
  assert.deepEqual((await call(me.uid, 'GET', '/api/people?q=a')).body, { people: [] });
  assert.deepEqual((await call(me.uid, 'GET', '/api/people')).body, { people: [] });
  const found = (await call(me.uid, 'GET', `/api/people?q=${tag.toUpperCase()}`)).body.people;
  // a name that starts with the text comes first, then the rest; never me
  assert.deepEqual(found.map((p: any) => p.id), [p2.id, p1.id]);
  assert.deepEqual(found[0].relation, { following: false, followsMe: false, mutual: false });
  assert.deepEqual(Object.keys(found[0]).sort(), ['color', 'displayName', 'id', 'relation']);
  assert.deepEqual((await call(me.uid, 'GET', '/api/people?q=%25%25')).body, { people: [] });
  assert.deepEqual((await call(me.uid, 'GET', '/api/people?q=__')).body, { people: [] });
  // an id is not searchable
  assert.deepEqual((await call(me.uid, 'GET', `/api/people?q=${p1.id}`)).body, { people: [] });
});

test('person page: not found, self, relation and summary flags', async () => {
  const { a, b } = await friends();
  assert.equal((await call(a.uid, 'GET', `/api/people/${NOBODY}`)).status, 404);
    const me = (await call(a.uid, 'GET', `/api/people/${a.id}`)).body.person;
  assert.equal(me.self, true);
  assert.deepEqual(me.relation, { following: false, followsMe: false, mutual: false });
  const other = (await call(a.uid, 'GET', `/api/people/${b.id.toUpperCase()}`)).body.person;
  assert.equal(other.self, false);
  assert.deepEqual(other.relation, { following: true, followsMe: true, mutual: true });
  assert.equal(other.followers, 1);
  assert.equal(other.following, 1);
  assert.equal(other.summaryAccess, false);
  assert.equal(other.sharedWithThem, false);
  await call(a.uid, 'POST', '/api/shares', { id: b.id });
  assert.equal((await call(a.uid, 'GET', `/api/people/${b.id}`)).body.person.sharedWithThem, true);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}`)).body.person.summaryAccess, true);
});

test('follow: needs a profile, a real person, not yourself; idempotent; unfollow is soft and re-follow works', async () => {
  const a = await person();
  const b = await person();
  const ghost = user();
  assert.equal((await call(ghost, 'POST', '/api/follow', { id: b.id })).status, 403);
  assert.equal((await call(a.uid, 'POST', '/api/follow', { id: NOBODY })).status, 404);
  assert.equal((await call(a.uid, 'POST', '/api/follow', { id: a.id })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/follow', { id: 'X' })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/follow', { id: b.id, more: 1 })).status, 400);
  assert.equal((await follow(a, b)).status, 200);
  assert.equal((await follow(a, b)).status, 200);
  const list = (await call(a.uid, 'GET', '/api/follows')).body;
  assert.deepEqual(list.following.map((p: any) => p.id), [b.id]);
  assert.deepEqual(list.following[0].relation, { following: true, followsMe: false, mutual: false });
  assert.deepEqual((await call(b.uid, 'GET', '/api/follows')).body.followers.map((p: any) => p.id), [a.id]);
  assert.equal((await call(b.uid, 'GET', '/api/profile')).body.followers, 1);

  assert.equal((await call(a.uid, 'POST', '/api/unfollow', { id: b.id })).status, 200);
  assert.equal((await call(a.uid, 'POST', '/api/unfollow', { id: b.id })).status, 200);
  assert.deepEqual((await call(a.uid, 'GET', '/api/follows')).body.following, []);
  assert.equal((await call(b.uid, 'GET', '/api/profile')).body.followers, 0);
  // nothing was removed: the row is archived
  const rows = (await pool.query('select archived_at_ms from follows where archived_at_ms is not null')).rows;
  assert.ok(rows.length >= 1);
  assert.equal((await follow(a, b)).status, 200);
  assert.deepEqual((await call(a.uid, 'GET', '/api/follows')).body.following.map((p: any) => p.id), [b.id]);
  assert.equal((await call(a.uid, 'POST', '/api/unfollow', { id: NOBODY })).status, 404);
});

test('follows list is newest first', async () => {
  const a = await person();
  const b = await person();
  const c = await person();
  await follow(a, b);
  await new Promise((r) => setTimeout(r, 5));
  await follow(a, c);
  assert.deepEqual((await call(a.uid, 'GET', '/api/follows')).body.following.map((p: any) => p.id), [c.id, b.id]);
});

test('messages: only between mutual followers, validated, ordered, with since', async () => {
  const a = await person();
  const b = await person();
  const send = (from: { uid: string }, to: { id: string }, body: unknown) => call(from.uid, 'POST', '/api/messages', { to: to.id, body });
  assert.equal((await send(a, b, 'hi')).status, 403);
  await follow(a, b);
  const oneWay = await send(a, b, 'hi');
  assert.equal(oneWay.status, 403);
  assert.deepEqual(oneWay.body, { error: 'not_mutual' });
  assert.equal((await call(a.uid, 'GET', `/api/messages/${b.id}`)).body.canSend, false);
  await follow(b, a);
  assert.equal((await call(a.uid, 'GET', `/api/messages/${b.id}`)).body.canSend, true);

  assert.equal((await send(a, a, 'me')).status, 400);
  assert.equal((await send(a, { id: NOBODY }, 'x')).status, 404);
  for (const body of ['', '   ', 'x'.repeat(1001), 'a\u0000b', 5, null]) assert.equal((await send(a, b, body)).status, 400, String(body));
  assert.equal((await call(a.uid, 'POST', '/api/messages', { to: b.id, body: 'x', extra: 1 })).status, 400);
  assert.equal((await send({ uid: user() }, b, 'x')).status, 403);

  const m1 = await send(a, b, '  first  ');
  assert.equal(m1.status, 201);
  assert.equal(m1.body.message.body, 'first');
  assert.equal(m1.body.message.mine, true);
  assert.equal(m1.body.message.readAt, null);
  assert.match(m1.body.message.id, /^[0-9a-f-]{36}$/);
  const m2 = await send(b, a, 'second');
  await send(a, b, 'x'.repeat(1000));
  const thread = (await call(a.uid, 'GET', `/api/messages/${b.id}`)).body;
  assert.deepEqual(thread.messages.map((m: any) => m.mine), [true, false, true]);
  assert.equal(thread.messages[0].body, 'first');
  const theirs = (await call(b.uid, 'GET', `/api/messages/${a.id}`)).body.messages;
  assert.deepEqual(theirs.map((m: any) => m.mine), [false, true, false]);
  const since = (await call(a.uid, 'GET', `/api/messages/${b.id}?since=${m2.body.message.createdAt - 1}`)).body.messages;
  assert.ok(since.length >= 1 && since.every((m: any) => m.createdAt > m2.body.message.createdAt - 1));
  assert.deepEqual((await call(a.uid, 'GET', `/api/messages/${b.id}?since=99999999999999`)).body.messages, []);
  assert.equal((await call(a.uid, 'GET', `/api/messages/${b.id}?since=abc`)).status, 400);
  assert.equal((await call(a.uid, 'GET', `/api/messages/${NOBODY}`)).status, 404);
  // a third person sees nothing of this thread
  const c = await person();
  assert.deepEqual((await call(c.uid, 'GET', `/api/messages/${a.id}`)).body.messages, []);
});

test('messages: the thread keeps only the last 100 without since', async () => {
  const { a, b } = await friends();
  await pool.query(
    `insert into messages (id, sender_id, recipient_id, body, created_at_ms)
     select gen_random_uuid()::text, $1, $2, 'm' || i, 1700000000000 + i from generate_series(0, 104) as i`,
    [a.uid, b.uid],
  );
  const thread = (await call(a.uid, 'GET', `/api/messages/${b.id}`)).body.messages;
  assert.equal(thread.length, 100);
  assert.equal(thread[0].body, 'm5');
  assert.equal(thread[99].body, 'm104');
});

test('unread counts, conversations and marking as read', async () => {
  const { a, b } = await friends();
  const c = await person();
  await follow(a, c);
  await follow(c, a);
  const send = (from: { uid: string }, to: { id: string }, body: string) => call(from.uid, 'POST', '/api/messages', { to: to.id, body });
  await send(b, a, 'one');
  await send(b, a, 'two');
  await new Promise((r) => setTimeout(r, 3));
  await send(c, a, 'hello from c');
  assert.equal((await call(a.uid, 'GET', '/api/unread')).body.unread, 3);
  assert.equal((await call(b.uid, 'GET', '/api/unread')).body.unread, 0);
  const convs = (await call(a.uid, 'GET', '/api/conversations')).body.conversations;
  assert.deepEqual(convs.map((x: any) => x.with.id), [c.id, b.id]);
  assert.equal(convs[0].last.body, 'hello from c');
  assert.equal(convs[0].last.mine, false);
  assert.equal(convs[0].unread, 1);
  assert.equal(convs[1].unread, 2);
  assert.equal(typeof convs[0].last.createdAt, 'number');
  assert.deepEqual(convs[1].with.relation, { following: true, followsMe: true, mutual: true });

  assert.equal((await call(a.uid, 'POST', '/api/messages/read', { id: b.id })).status, 200);
  assert.equal((await call(a.uid, 'GET', '/api/unread')).body.unread, 1);
  const read = (await call(a.uid, 'GET', `/api/messages/${b.id}`)).body.messages;
  assert.ok(read.every((m: any) => typeof m.readAt === 'number'));
  // the sender sees it as read too, and an unrelated read does not touch other threads
  assert.ok((await call(b.uid, 'GET', `/api/messages/${a.id}`)).body.messages.every((m: any) => typeof m.readAt === 'number'));
  assert.equal((await call(a.uid, 'GET', '/api/conversations')).body.conversations.find((x: any) => x.with.id === c.id).unread, 1);
  assert.equal((await call(a.uid, 'POST', '/api/messages/read', { id: NOBODY })).status, 404);
  // my own sent messages never count as unread for me
  await send(a, b, 'reply');
  assert.equal((await call(a.uid, 'GET', '/api/unread')).body.unread, 1);
  assert.equal((await call(b.uid, 'GET', '/api/unread')).body.unread, 1);
});

test('a conversation stays readable after unfollowing, but sending stops', async () => {
  const { a, b } = await friends();
  await call(a.uid, 'POST', '/api/messages', { to: b.id, body: 'hi' });
  await call(b.uid, 'POST', '/api/unfollow', { id: a.id });
  const thread = (await call(a.uid, 'GET', `/api/messages/${b.id}`)).body;
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.canSend, false);
  assert.equal((await call(a.uid, 'POST', '/api/messages', { to: b.id, body: 'again' })).status, 403);
  assert.equal((await call(a.uid, 'GET', '/api/conversations')).body.conversations.length, 1);
});

test('shares: need a mutual follow, list both sides, revoke blocks at once', async () => {
  const a = await person();
  const b = await person();
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: b.id })).status, 403);
  await follow(a, b);
  assert.deepEqual((await call(a.uid, 'POST', '/api/shares', { id: b.id })).body, { error: 'not_mutual' });
  await follow(b, a);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: a.id })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: NOBODY })).status, 404);
  assert.equal((await call(user(), 'POST', '/api/shares', { id: b.id })).status, 403);
  assert.equal((await call(a.uid, 'PUT', '/api/summary', summary())).status, 200);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: b.id })).status, 200);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: b.id })).status, 200);

  const mine = (await call(a.uid, 'GET', '/api/shares')).body;
  assert.deepEqual(mine.given.map((p: any) => p.id), [b.id]);
  assert.deepEqual(mine.received, []);
  assert.deepEqual((await call(b.uid, 'GET', '/api/shares')).body.received.map((p: any) => p.id), [a.id]);

  const seen = await call(b.uid, 'GET', `/api/people/${a.id}/summary`);
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.summary, summary());
  assert.equal(typeof seen.body.updatedAt, 'number');

  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { id: b.id })).status, 200);
  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { id: b.id })).status, 200);
  const blocked = await call(b.uid, 'GET', `/api/people/${a.id}/summary`);
  assert.equal(blocked.status, 403);
  assert.deepEqual(blocked.body, { error: 'not_shared' });
  assert.deepEqual((await call(a.uid, 'GET', '/api/shares')).body.given, []);
  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { id: NOBODY })).status, 404);
  // the row is kept, stamped as revoked; sharing again re-activates it
  assert.ok((await pool.query('select 1 from summary_shares where revoked_at_ms is not null')).rowCount! >= 1);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: b.id })).status, 200);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).status, 200);
});

test('summary: the owner reads their own, outsiders and people without a share get the same 403', async () => {
  const { a, b } = await friends();
  const outsider = await person();
  assert.deepEqual((await call(a.uid, 'GET', `/api/people/${a.id}/summary`)).body, { summary: null, updatedAt: null });
  assert.equal((await call(a.uid, 'PUT', '/api/summary', summary())).status, 200);
  assert.deepEqual((await call(a.uid, 'GET', `/api/people/${a.id}/summary`)).body.summary, summary());
  const replaced = summary({ months: [] });
  await call(a.uid, 'PUT', '/api/summary', replaced);
  assert.deepEqual((await call(a.uid, 'GET', `/api/people/${a.id}/summary`)).body.summary, replaced);

  const noShare = await call(b.uid, 'GET', `/api/people/${a.id}/summary`);
  const stranger = await call(outsider.uid, 'GET', `/api/people/${a.id}/summary`);
  const missing = await call(b.uid, 'GET', `/api/people/${NOBODY}/summary`);
  for (const r of [noShare, stranger, missing]) {
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'not_shared' });
  }
  // a share alone is not enough from an outsider: it needs the mutual follow, so nobody else can be shared with
  assert.equal((await call(a.uid, 'POST', '/api/shares', { id: outsider.id })).status, 403);
  // someone who has no profile cannot read either
  assert.equal((await call(user(), 'GET', `/api/people/${a.id}/summary`)).status, 403);
});

test('unfollowing revokes the shares in both directions, and refollowing does not bring them back', async () => {
  const { a, b } = await friends();
  await call(a.uid, 'PUT', '/api/summary', summary());
  await call(b.uid, 'PUT', '/api/summary', summary());
  await call(a.uid, 'POST', '/api/shares', { id: b.id });
  await call(b.uid, 'POST', '/api/shares', { id: a.id });
  assert.equal((await call(a.uid, 'GET', `/api/people/${b.id}/summary`)).status, 200);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).status, 200);
  await call(b.uid, 'POST', '/api/unfollow', { id: a.id });
  assert.equal((await call(a.uid, 'GET', `/api/people/${b.id}/summary`)).status, 403);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).status, 403);
  assert.deepEqual((await call(a.uid, 'GET', '/api/shares')).body, { given: [], received: [] });
  await follow(b, a);
  assert.equal((await call(a.uid, 'GET', `/api/people/${b.id}/summary`)).status, 403);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).status, 403);
});

test('a share is ignored if the follow was archived behind its back', async () => {
  const { a, b } = await friends();
  await call(a.uid, 'PUT', '/api/summary', summary());
  await call(a.uid, 'POST', '/api/shares', { id: b.id });
  // simulate a broken state: the follow is archived but the share was left active
  await pool.query('update follows set archived_at_ms = 1 where follower_id = $1 and followee_id = $2', [b.uid, a.uid]);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).status, 403);
  assert.deepEqual((await call(b.uid, 'GET', '/api/shares')).body.received, []);
  assert.deepEqual((await call(a.uid, 'GET', '/api/shares')).body.given, []);
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.id}`)).body.person.summaryAccess, false);
});

test('summary validation: percentages only, strict shape', async () => {
  const uid = user();
  const month = { key: '2026-10', spent: 50, saved: 50, categories: [] as unknown[] };
  const cat = { slug: 'x', label: 'X', pct: 5 };
  const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
  const bads: unknown[] = [
    null, [], {}, 'x',
    // the old version and money fields are not accepted
    { version: 1, generatedAt: 1, months: [{ key: '2026-10', income: 500000, expense: 300000, left: 200000 }], categories: [{ slug: 'x', label: 'X', amount: 100 }] },
    summary({ version: 1 }), summary({ version: 3 }), summary({ version: undefined }),
    summary({ income: 500000 }), summary({ amount: 5 }), summary({ extra: 1 }),
    summary({ months: [{ ...month, income: 500000 }] }), summary({ months: [{ ...month, expense: 1 }] }), summary({ months: [{ ...month, left: 1 }] }),
    summary({ categories: [{ ...cat, amount: 500 }] }), summary({ categories: [{ slug: 'x', label: 'X', amount: 500 }] }),
    summary({ generatedAt: -1 }), summary({ generatedAt: 1.5 }),
    summary({ spent: -0.1 }), summary({ spent: 1000.1 }), summary({ spent: '5' }), summary({ spent: null }), summary({ spent: undefined }),
    summary({ saved: -1000.1 }), summary({ saved: 100.1 }), summary({ saved: 'x' }), summary({ saved: undefined }),
    summary({ months: 'x' }), summary({ months: many(25, (i) => ({ ...month, key: `2024-${String((i % 12) + 1).padStart(2, '0')}` })) }),
    summary({ months: [{ ...month, key: '2026-13' }] }), summary({ months: [{ ...month, key: '2026-1' }] }), summary({ months: [month, month] }),
    summary({ months: [{ ...month, spent: -1 }] }), summary({ months: [{ ...month, spent: 1001 }] }), summary({ months: [{ ...month, saved: -1001 }] }),
    summary({ months: [{ ...month, saved: 101 }] }), summary({ months: [{ key: '2026-10', spent: 1, saved: 1 }] }), summary({ months: [{ ...month, more: 1 }] }),
    summary({ months: [{ ...month, categories: many(41, (i) => ({ ...cat, slug: `c${i}` })) }] }), summary({ months: [{ ...month, categories: [{ ...cat, pct: -1 }] }] }),
    summary({ categories: many(41, (i) => ({ ...cat, slug: `c${i}` })) }), summary({ categories: [{ ...cat, pct: -0.5 }] }), summary({ categories: [{ ...cat, pct: 1000.5 }] }),
    summary({ categories: [{ ...cat, pct: Number.NaN }] }), summary({ categories: [{ ...cat, pct: '5' }] }), summary({ categories: [{ ...cat, slug: '' }] }),
    summary({ categories: [{ ...cat, label: 'x'.repeat(41) }] }), summary({ categories: [{ ...cat, slug: 'a\u0000b' }] }), summary({ categories: [{ ...cat, extra: 1 }] }),
    summary({ categories: [{ slug: 'x', label: 'X' }] }), summary({ categories: 'x' }),
  ];
  for (const b of bads) assert.equal((await call(uid, 'PUT', '/api/summary', b)).status, 400, JSON.stringify(b)?.slice(0, 100));
  const ok = summary({
    spent: 1000, saved: -1000,
    months: many(24, (i) => ({ key: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, spent: 0, saved: 100, categories: many(40, (j) => ({ slug: `c${j}`, label: 'L', pct: 0 })) })),
    categories: many(40, (j) => ({ slug: `c${j}`, label: 'L', pct: 1000 })),
  });
  assert.equal((await call(uid, 'PUT', '/api/summary', ok)).status, 200);
  assert.equal((await call(uid, 'PUT', '/api/summary', summary({ months: [], categories: [] }))).status, 200);
});

test('summary: decimals round-trip as stored, and an old version 1 snapshot is returned unchanged', async () => {
  const { a, b } = await friends();
  const s = summary({ spent: 33.333333333333336, saved: 66.66666666666666, categories: [{ slug: 'x', label: 'X', pct: 0.1 }] });
  assert.equal((await call(a.uid, 'PUT', '/api/summary', s)).status, 200);
  await call(a.uid, 'POST', '/api/shares', { id: b.id });
  assert.deepEqual((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).body.summary, s);
  // a snapshot stored before this change (version 1, cents) is simply returned as it is: the front end ignores it
  const old = { version: 1, generatedAt: 1, months: [{ key: '2026-10', income: 5, expense: 3, left: 2 }], categories: [] };
  await pool.query('update profile_summaries set summary = $2::jsonb where user_id = $1', [a.uid, JSON.stringify(old)]);
  assert.deepEqual((await call(b.uid, 'GET', `/api/people/${a.id}/summary`)).body.summary, old);
});

test('no response ever carries a user id, and /api/data stays free of social data', async () => {
  const { a, b } = await friends();
  await call(a.uid, 'POST', '/api/messages', { to: b.id, body: 'secret' });
  await call(a.uid, 'PUT', '/api/summary', summary());
  await call(a.uid, 'POST', '/api/shares', { id: b.id });
  // `call` asserts that no uid appears in any body; walk the whole surface once more as both people
  for (const who of [a, b]) {
    for (const url of ['/api/profile', '/api/follows', '/api/conversations', '/api/shares', '/api/unread', `/api/people?q=${a.id}`, `/api/people?q=${b.id}`,
      `/api/people/${a.id}`, `/api/people/${b.id}`, `/api/messages/${a.id}`, `/api/messages/${b.id}`, `/api/people/${a.id}/summary`]) {
      await call(who.uid, 'GET', url);
    }
  }
  assert.equal((await call(a.uid, 'PUT', '/api/data', { transactions: [tx()] })).status, 200);
  const data = (await call(b.uid, 'GET', '/api/data')).body;
  assert.deepEqual(Object.keys(data).sort(), ['cards', 'categories', 'payments', 'reserveMoves', 'reserves', 'transactions']);
  assert.deepEqual(data.transactions, []);
  const mine = (await call(a.uid, 'GET', '/api/data')).body;
  assert.equal(JSON.stringify(mine).includes('secret'), false);
  assert.equal(JSON.stringify(mine).includes(a.id), false);
});

test('the chatty routes have their own stricter rate limit (30 per minute)', async () => {
  const limited = await buildApp({
    pool,
    verify: async (t) => {
      if (!t.startsWith('tok:')) throw new Error('bad token');
      return { uid: t.slice(4) };
    },
  });
  const uid = user();
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await limited.inject({ method: 'GET', url: '/api/people?q=zz', headers: bearer(uid) })).statusCode;
  assert.equal(last, 429);
  await limited.close();
});

test('CORS allows POST', async () => {
  const cors = await buildApp({ pool, allowedOrigins: ['http://localhost:8081'], verify: async () => ({ uid: 'x' }) });
  const r = await cors.inject({ method: 'OPTIONS', url: '/api/follow', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST' } });
  assert.match(String(r.headers['access-control-allow-methods']), /POST/);
  await cors.close();
});
