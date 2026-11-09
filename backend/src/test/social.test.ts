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
/** a well-formed code that belongs to nobody (a digits-only code is not handed out as "ZZZZZZ") */
const NOBODY = 'ZZZZZZ';
const CODE = /^[0-9A-HJ-NP-Z]{6}$/;

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
  return { uid, code: r.body.profile.code as string };
}
const send = (from: { uid: string }, to: { code: string }, body: unknown) => call(from.uid, 'POST', '/api/messages', { to: to.code, body });
const share = (from: { uid: string }, to: { code: string }) => call(from.uid, 'POST', '/api/shares', { code: to.code });
const readSummary = (viewer: { uid: string }, owner: { code: string }) => call(viewer.uid, 'GET', `/api/people/${owner.code}/summary`);

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

test('summary: incomeRel (income relative to the average month) is optional, a plain percentage and bounded', async () => {
  const a = await person('Ana');
  const month = (over: Record<string, unknown>) => summary({ months: [{ key: '2026-10', spent: 60, saved: 40, categories: [], ...over }] });
  assert.equal((await call(a.uid, 'PUT', '/api/summary', month({ incomeRel: 112.5 }))).status, 200);
  assert.deepEqual((await readSummary(a, a)).body.summary.months[0].incomeRel, 112.5);
  assert.equal((await call(a.uid, 'PUT', '/api/summary', month({}))).status, 200);
  for (const bad of [-1, 10001, '100', null, Infinity]) assert.equal((await call(a.uid, 'PUT', '/api/summary', month({ incomeRel: bad }))).status, 400);
});

test('every social route needs a token', async () => {
  const routes: [string, string][] = [
    ['GET', '/api/profile'], ['PUT', '/api/profile'], ['GET', '/api/people/482913'], ['GET', '/api/conversations'],
    ['GET', '/api/messages/482913'], ['POST', '/api/messages'], ['POST', '/api/messages/read'], ['GET', '/api/unread'],
    ['GET', '/api/shares'], ['POST', '/api/shares'], ['POST', '/api/shares/revoke'], ['PUT', '/api/summary'], ['GET', '/api/people/482913/summary'],
  ];
  for (const [method, url] of routes) {
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const r = await app.inject({ method: method as 'GET', url, headers, payload: method === 'GET' ? undefined : {} });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
      assert.deepEqual(r.json(), { error: 'unauthorized' });
    }
  }
});

test('the follow and search routes are gone', async () => {
  const a = await person();
  for (const [method, url, payload] of [
    ['POST', '/api/follow', { code: NOBODY }], ['POST', '/api/unfollow', { code: NOBODY }], ['GET', '/api/follows', undefined],
    ['GET', '/api/people?q=ana', undefined], ['GET', '/api/people', undefined],
  ] as const) {
    const r = await call(a.uid, method, url, payload);
    assert.equal(r.status, 404, `${method} ${url}`);
  }
});

test('profile: empty, create with a code, update, read back and validation', async () => {
  const uid = user();
  assert.deepEqual((await call(uid, 'GET', '/api/profile')).body, { profile: null });
  const created = await call(uid, 'PUT', '/api/profile', { displayName: '  Ana Lima ', color: '#2D55D9' });
  assert.equal(created.status, 200);
  const code = created.body.profile.code as string;
  assert.match(code, CODE);
  assert.deepEqual(created.body.profile, { code, displayName: 'Ana Lima', color: '#2D55D9', photo: null });
  const again = await call(uid, 'PUT', '/api/profile', { displayName: 'Ana' });
  assert.deepEqual(again.body.profile, { code, displayName: 'Ana', color: null, photo: null });
  assert.deepEqual((await call(uid, 'GET', '/api/profile')).body, { profile: { code, displayName: 'Ana', color: null, photo: null } });

  for (const bad of [
    {}, { displayName: '' }, { displayName: '   ' }, { displayName: 'x'.repeat(41) }, { displayName: 'x', color: 'red' },
    { displayName: 'x', extra: 1 }, { displayName: 'x', handle: 'ana_lima' }, { displayName: 'x', bio: 'hello' }, { displayName: 'x', code: '123456' },
    { displayName: 'x\u0000y' }, { displayName: 5 },
  ]) {
    const r = await call(uid, 'PUT', '/api/profile', bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'invalid');
  }
  assert.equal((await call(uid, 'PUT', '/api/profile', [1])).status, 400);
});

test('profile: the code is stable across edits, is never the Firebase uid, and two people can share a name', async () => {
  const a = await person('Same Name');
  const b = await person('Same Name');
  assert.notEqual(a.code, b.code);
  assert.notEqual(a.code, a.uid);
  for (let i = 0; i < 3; i++) await call(a.uid, 'PUT', '/api/profile', { displayName: `Renamed ${i}`, color: '#000000' });
  assert.equal((await call(a.uid, 'GET', '/api/profile')).body.profile.code, a.code);
  // the old columns are never written
  const row = (await pool.query('select handle, bio from profiles where user_id = $1', [a.uid])).rows[0];
  assert.deepEqual(row, { handle: null, bio: null });
  // codes are random, not sequential: many new profiles never get consecutive codes, and digits-only codes come first
  const codes: string[] = [];
  for (let i = 0; i < 12; i++) codes.push((await person()).code);
  assert.equal(new Set(codes).size, 12);
  assert.ok(codes.every((c) => /^[0-9]{6}$/.test(c)), 'there is plenty of room in the digits-only tier');
  assert.ok(codes.every((c, i) => i === 0 || Math.abs(Number(c) - Number(codes[i - 1])) > 1));
});

test('profile: a legacy profile without a code gets one the first time it is loaded, and keeps it', async () => {
  const uid = user();
  // a row as it was before codes existed
  await pool.query("insert into profiles (user_id, display_name, created_at_ms) values ($1, 'Old Timer', 1)", [uid]);
  assert.equal((await pool.query('select code from profiles where user_id = $1', [uid])).rows[0].code, null);
  const first = await call(uid, 'GET', '/api/profile');
  const code = first.body.profile.code as string;
  assert.match(code, CODE);
  assert.equal((await call(uid, 'GET', '/api/profile')).body.profile.code, code);
  assert.equal((await pool.query('select code from profiles where user_id = $1', [uid])).rows[0].code, code);
  // and a legacy profile that saves its profile (PUT) gets one too
  const uid2 = user();
  await pool.query("insert into profiles (user_id, display_name, created_at_ms) values ($1, 'Older', 1)", [uid2]);
  const put = await call(uid2, 'PUT', '/api/profile', { displayName: 'Older' });
  assert.match(put.body.profile.code, CODE);
  assert.equal((await call(uid2, 'GET', '/api/profile')).body.profile.code, put.body.profile.code);
});

test('profile: the database refuses a malformed or repeated code', async () => {
  const a = await person();
  const b = await person();
  await assert.rejects(pool.query("update profiles set code = 'abc123' where user_id = $1", [a.uid]));
  await assert.rejects(pool.query("update profiles set code = 'ABCDEI' where user_id = $1", [a.uid]));
  await assert.rejects(pool.query('update profiles set code = $2 where user_id = $1', [a.uid, b.code]));
});

const JPEG = (n = 40) => `data:image/jpeg;base64,${'/9j/4AAQSkZJRg'.repeat(n).slice(0, n * 4)}==`;

test('profile photo: set, replace, keep when absent, clear', async () => {
  const uid = user();
  const first = JPEG(40);
  const created = await call(uid, 'PUT', '/api/profile', { displayName: 'Ana', photo: first });
  assert.equal(created.status, 200);
  assert.equal(created.body.profile.photo, first);
  assert.equal((await call(uid, 'GET', '/api/profile')).body.profile.photo, first);
  // editing the name (or color) without the key keeps the photo
  assert.equal((await call(uid, 'PUT', '/api/profile', { displayName: 'Ana B', color: '#111111' })).body.profile.photo, first);
  assert.equal((await call(uid, 'GET', '/api/profile')).body.profile.photo, first);
  const second = JPEG(80);
  assert.equal((await call(uid, 'PUT', '/api/profile', { displayName: 'Ana B', photo: second })).body.profile.photo, second);
  assert.equal((await call(uid, 'PUT', '/api/profile', { displayName: 'Ana B', photo: undefined })).body.profile.photo, second);
  const cleared = await call(uid, 'PUT', '/api/profile', { displayName: 'Ana B', photo: null });
  assert.equal(cleared.body.profile.photo, null);
  assert.equal((await call(uid, 'GET', '/api/profile')).body.profile.photo, null);
  assert.equal((await call(user(), 'PUT', '/api/profile', { displayName: 'New' })).body.profile.photo, null);
  const max = `data:image/jpeg;base64,${'A'.repeat(60000 - 23)}`;
  assert.equal(max.length, 60000);
  assert.equal((await call(uid, 'PUT', '/api/profile', { displayName: 'Ana B', photo: max })).status, 200);
});

test('profile photo: only small JPEG data URLs are accepted', async () => {
  const uid = user();
  const bads: unknown[] = [
    'data:image/png;base64,iVBORw0KGgo=', 'data:image/jpg;base64,/9j/4AAQ', 'data:image/jpeg;base64,', 'data:image/jpeg;base64,=', 'data:image/jpeg,/9j/4AAQ',
    'data:image/jpeg;base64,/9j/4AAQ$$$', 'data:image/jpeg;base64,/9j/ 4AAQ', 'data:image/jpeg;base64,/9j/4AAQ\n', 'data:image/jpeg;base64,/9j/4=AAQ',
    'data:image/jpeg;base64,\u0000AAAA', ' data:image/jpeg;base64,/9j/4AAQ', 'https://example.com/me.jpg', '<script>alert(1)</script>', '', 'x',
    `data:image/jpeg;base64,${'A'.repeat(60000)}`, 5, true, {}, [], ['data:image/jpeg;base64,/9j/4AAQ'],
  ];
  for (const photo of bads) {
    const r = await call(uid, 'PUT', '/api/profile', { displayName: 'Ana', photo });
    assert.equal(r.status, 400, JSON.stringify(photo)?.slice(0, 60));
    assert.equal(r.body.error, 'invalid');
  }
  assert.deepEqual((await call(uid, 'GET', '/api/profile')).body.profile, null);
  assert.equal((await call(uid, 'PUT', '/api/profile', { displayName: 'Ana', photo: JPEG(), extra: 1 })).status, 400);
  await call(uid, 'PUT', '/api/profile', { displayName: 'Ana' });
  await assert.rejects(pool.query("update profiles set photo = 'data:image/png;base64,AAAA' where user_id = $1", [uid]));
  await assert.rejects(pool.query("update profiles set photo = 'data:image/jpeg;base64,' || repeat('A', 60000) where user_id = $1", [uid]));
});

test('lookup by code: found, case-insensitive, unknown or malformed is 404, flags for self and for shares', async () => {
  const a = await person('Ana');
  const b = await person('Bob');
  assert.equal((await call(a.uid, 'GET', `/api/people/${NOBODY}`)).status, 404);
  for (const bad of ['abc', '12345', '1234567', 'ABCDEI', 'ABCDEO', '12-456', '%20', `${b.code}x`, 'ñññññññ']) {
    assert.equal((await call(a.uid, 'GET', `/api/people/${encodeURIComponent(bad)}`)).status, 404, bad);
  }
  const self = (await call(a.uid, 'GET', `/api/people/${a.code}`)).body.person;
  assert.deepEqual(self, { code: a.code, displayName: 'Ana', color: null, photo: null, self: true, summaryAccess: true, sharedWithThem: false, sharesWithMe: false });
  const other = (await call(a.uid, 'GET', `/api/people/${b.code.toLowerCase()}`)).body.person;
  assert.deepEqual(other, { code: b.code, displayName: 'Bob', color: null, photo: null, self: false, summaryAccess: false, sharedWithThem: false, sharesWithMe: false });
  assert.deepEqual(Object.keys(other).sort(), ['code', 'color', 'displayName', 'photo', 'self', 'sharedWithThem', 'sharesWithMe', 'summaryAccess']);
  // I share with them: only sharedWithThem; they share with me: summaryAccess and sharesWithMe
  await share(a, b);
  const afterA = (await call(a.uid, 'GET', `/api/people/${b.code}`)).body.person;
  assert.equal(afterA.sharedWithThem, true);
  assert.equal(afterA.summaryAccess, false);
  assert.equal(afterA.sharesWithMe, false);
  const fromB = (await call(b.uid, 'GET', `/api/people/${a.code}`)).body.person;
  assert.equal(fromB.summaryAccess, true);
  assert.equal(fromB.sharesWithMe, true);
  assert.equal(fromB.sharedWithThem, false);
});

test('messaging works by code with no follow at all, and is validated', async () => {
  const a = await person();
  const b = await person();
  assert.equal((await send(a, a, 'me')).status, 400);
  assert.equal((await send(a, { code: NOBODY }, 'x')).status, 404);
  assert.equal((await call(a.uid, 'POST', '/api/messages', { to: 'abc', body: 'x' })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/messages', { to: b.code, body: 'x', extra: 1 })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/messages', { body: 'x' })).status, 400);
  for (const body of ['', '   ', 'x'.repeat(1001), 'a\u0000b', 5, null]) assert.equal((await send(a, b, body)).status, 400, String(body));
  const noProfile = await send({ uid: user() }, b, 'x');
  assert.equal(noProfile.status, 403);
  assert.deepEqual(noProfile.body, { error: 'profile_required' });

  const m1 = await send(a, b, '  first  ');
  assert.equal(m1.status, 201);
  assert.equal(m1.body.message.body, 'first');
  assert.equal(m1.body.message.mine, true);
  assert.equal(m1.body.message.readAt, null);
  assert.match(m1.body.message.id, /^[0-9a-f-]{36}$/);
  // the code works in lower case too
  assert.equal((await call(b.uid, 'POST', '/api/messages', { to: a.code.toLowerCase(), body: 'second' })).status, 201);
  assert.equal((await send(a, b, 'x'.repeat(1000))).status, 201);
  const thread = (await call(a.uid, 'GET', `/api/messages/${b.code}`)).body;
  assert.equal(thread.canSend, true);
  assert.deepEqual(thread.messages.map((m: any) => m.mine), [true, false, true]);
  assert.equal(thread.messages[0].body, 'first');
  assert.deepEqual((await call(b.uid, 'GET', `/api/messages/${a.code}`)).body.messages.map((m: any) => m.mine), [false, true, false]);
  assert.equal((await call(a.uid, 'GET', `/api/messages/${NOBODY}`)).status, 404);
  assert.equal((await call(a.uid, 'GET', '/api/messages/abc')).status, 404);
  // a third person sees nothing of this thread
  const c = await person();
  assert.deepEqual((await call(c.uid, 'GET', `/api/messages/${a.code}`)).body.messages, []);
});

test('messages: since, the last 100, and the ordering', async () => {
  const a = await person();
  const b = await person();
  const m1 = await send(a, b, 'one');
  await new Promise((r) => setTimeout(r, 3));
  const m2 = await send(b, a, 'two');
  const since = (await call(a.uid, 'GET', `/api/messages/${b.code}?since=${m1.body.message.createdAt}`)).body.messages;
  assert.deepEqual(since.map((m: any) => m.body), ['two']);
  assert.equal(since[0].createdAt, m2.body.message.createdAt);
  assert.deepEqual((await call(a.uid, 'GET', `/api/messages/${b.code}?since=99999999999999`)).body.messages, []);
  assert.equal((await call(a.uid, 'GET', `/api/messages/${b.code}?since=abc`)).status, 400);
  await pool.query(
    `insert into messages (id, sender_id, recipient_id, body, created_at_ms)
     select gen_random_uuid()::text, $1, $2, 'm' || i, 1700000000000 + i from generate_series(0, 104) as i`,
    [a.uid, b.uid],
  );
  const thread = (await call(a.uid, 'GET', `/api/messages/${b.code}`)).body.messages;
  assert.equal(thread.length, 100);
  assert.equal(thread[99].body, 'two');
  assert.deepEqual(thread.map((m: any) => m.createdAt), [...thread.map((m: any) => m.createdAt)].sort((x: number, y: number) => x - y));
});

test('unread counts, conversations and marking as read', async () => {
  const a = await person('A');
  const b = await person('B');
  const c = await person('C');
  await send(b, a, 'one');
  await send(b, a, 'two');
  await new Promise((r) => setTimeout(r, 3));
  await send(c, a, 'hello from c');
  assert.equal((await call(a.uid, 'GET', '/api/unread')).body.unread, 3);
  assert.equal((await call(b.uid, 'GET', '/api/unread')).body.unread, 0);
  const convs = (await call(a.uid, 'GET', '/api/conversations')).body.conversations;
  assert.deepEqual(convs.map((x: any) => x.with.code), [c.code, b.code]);
  assert.deepEqual(Object.keys(convs[0].with).sort(), ['code', 'color', 'displayName', 'photo']);
  assert.equal(convs[0].last.body, 'hello from c');
  assert.equal(convs[0].last.mine, false);
  assert.equal(convs[0].unread, 1);
  assert.equal(convs[1].unread, 2);
  assert.equal(typeof convs[0].last.createdAt, 'number');

  assert.equal((await call(a.uid, 'POST', '/api/messages/read', { code: b.code })).status, 200);
  assert.equal((await call(a.uid, 'GET', '/api/unread')).body.unread, 1);
  assert.ok((await call(a.uid, 'GET', `/api/messages/${b.code}`)).body.messages.every((m: any) => typeof m.readAt === 'number'));
  assert.ok((await call(b.uid, 'GET', `/api/messages/${a.code}`)).body.messages.every((m: any) => typeof m.readAt === 'number'));
  assert.equal((await call(a.uid, 'GET', '/api/conversations')).body.conversations.find((x: any) => x.with.code === c.code).unread, 1);
  assert.equal((await call(a.uid, 'POST', '/api/messages/read', { code: NOBODY })).status, 404);
  assert.equal((await call(a.uid, 'POST', '/api/messages/read', { code: 'x' })).status, 400);
  // my own sent messages never count as unread for me, and a reply makes the chat appear for the other side
  await send(a, b, 'reply');
  assert.equal((await call(a.uid, 'GET', '/api/unread')).body.unread, 1);
  assert.equal((await call(b.uid, 'GET', '/api/unread')).body.unread, 1);
  // someone who never exchanged a message has no conversations
  assert.deepEqual((await call((await person()).uid, 'GET', '/api/conversations')).body, { conversations: [] });
});

test('shares: many people on both sides, newest first, idempotent, and no follow needed', async () => {
  const a = await person('A');
  const b = await person('B');
  const c = await person('C');
  assert.equal((await call(user(), 'POST', '/api/shares', { code: b.code })).status, 403);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { code: a.code })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { code: NOBODY })).status, 404);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { code: 'abc' })).status, 400);
  assert.equal((await call(a.uid, 'POST', '/api/shares', { code: b.code, extra: 1 })).status, 400);
  assert.equal((await share(a, b)).status, 200);
  await new Promise((r) => setTimeout(r, 3));
  assert.equal((await share(a, c)).status, 200);
  assert.equal((await share(a, c)).status, 200);
  assert.equal((await share(b, a)).status, 200);
  assert.equal((await share(c, a)).status, 200);

  const mine = (await call(a.uid, 'GET', '/api/shares')).body;
  assert.deepEqual(mine.given.map((p: any) => p.code), [c.code, b.code]);
  assert.equal(mine.received.length, 2);
  assert.deepEqual(Object.keys(mine.given[0]).sort(), ['code', 'color', 'displayName', 'photo']);
  assert.deepEqual((await call(b.uid, 'GET', '/api/shares')).body, { given: [{ code: a.code, displayName: 'A', color: null, photo: null }], received: [{ code: a.code, displayName: 'A', color: null, photo: null }] });
});

test('summary: shared people read it, revoking blocks at once, outsiders and unknown codes get the same 403', async () => {
  const a = await person();
  const b = await person();
  const c = await person();
  const outsider = await person();
  assert.deepEqual((await readSummary(a, a)).body, { summary: null, updatedAt: null });
  assert.equal((await call(a.uid, 'PUT', '/api/summary', summary())).status, 200);
  assert.deepEqual((await readSummary(a, a)).body.summary, summary());
  await share(a, b);
  await share(a, c);

  const seen = await readSummary(b, a);
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.summary, summary());
  assert.equal(typeof seen.body.updatedAt, 'number');
  assert.equal((await readSummary(c, a)).status, 200);
  // the lookup code is accepted in lower case
  assert.equal((await call(b.uid, 'GET', `/api/people/${a.code.toLowerCase()}/summary`)).status, 200);

  for (const r of [await readSummary(outsider, a), await call(outsider.uid, 'GET', `/api/people/${NOBODY}/summary`), await call(outsider.uid, 'GET', '/api/people/abc/summary'), await call(user(), 'GET', `/api/people/${a.code}/summary`)]) {
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'not_shared' });
  }
  // being shared with does not give access the other way round
  assert.equal((await readSummary(a, b)).status, 403);

  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { code: b.code })).status, 200);
  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { code: b.code })).status, 200);
  const blocked = await readSummary(b, a);
  assert.equal(blocked.status, 403);
  assert.deepEqual(blocked.body, { error: 'not_shared' });
  assert.equal((await readSummary(c, a)).status, 200, 'revoking one person does not touch the others');
  assert.deepEqual((await call(a.uid, 'GET', '/api/shares')).body.given.map((p: any) => p.code), [c.code]);
  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { code: NOBODY })).status, 404);
  assert.equal((await call(a.uid, 'POST', '/api/shares/revoke', { code: 'abc' })).status, 400);
  // the row is kept, stamped as revoked; sharing again re-activates it
  assert.ok((await pool.query('select 1 from summary_shares where revoked_at_ms is not null')).rowCount! >= 1);
  assert.equal((await share(a, b)).status, 200);
  assert.equal((await readSummary(b, a)).status, 200);
  // the summary is replaced by the next publish, for everybody who can read it
  const replaced = summary({ months: [] });
  await call(a.uid, 'PUT', '/api/summary', replaced);
  assert.deepEqual((await readSummary(b, a)).body.summary, replaced);
});

test('summary validation: percentages only, strict shape', async () => {
  const uid = user();
  const month = { key: '2026-10', spent: 50, saved: 50, categories: [] as unknown[] };
  const cat = { slug: 'x', label: 'X', pct: 5 };
  const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
  const bads: unknown[] = [
    null, [], {}, 'x',
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
  const a = await person();
  const b = await person();
  const s = summary({ spent: 33.333333333333336, saved: 66.66666666666666, categories: [{ slug: 'x', label: 'X', pct: 0.1 }] });
  assert.equal((await call(a.uid, 'PUT', '/api/summary', s)).status, 200);
  await share(a, b);
  assert.deepEqual((await readSummary(b, a)).body.summary, s);
  const old = { version: 1, generatedAt: 1, months: [{ key: '2026-10', income: 5, expense: 3, left: 2 }], categories: [] };
  await pool.query('update profile_summaries set summary = $2::jsonb where user_id = $1', [a.uid, JSON.stringify(old)]);
  assert.deepEqual((await readSummary(b, a)).body.summary, old);
});

test('old follows are ignored: they neither allow nor block anything', async () => {
  const a = await person();
  const b = await person();
  await pool.query("insert into follows (follower_id, followee_id, created_at_ms) values ($1, $2, 1), ($2, $1, 1)", [a.uid, b.uid]);
  await call(a.uid, 'PUT', '/api/summary', summary());
  assert.equal((await readSummary(b, a)).status, 403, 'a follow is not a share');
  await share(a, b);
  await pool.query('update follows set archived_at_ms = 5 where follower_id = $1', [b.uid]);
  assert.equal((await readSummary(b, a)).status, 200, 'an archived follow does not stop a share');
});

test('no response ever carries a user id, and /api/data stays free of social data', async () => {
  const a = await person('Alice');
  const b = await person('Bob');
  await send(a, b, 'secret');
  await call(a.uid, 'PUT', '/api/summary', summary());
  await share(a, b);
  await share(b, a);
  for (const who of [a, b]) {
    for (const url of ['/api/profile', '/api/conversations', '/api/shares', '/api/unread', `/api/people/${a.code}`, `/api/people/${b.code}`,
      `/api/messages/${a.code}`, `/api/messages/${b.code}`, `/api/people/${a.code}/summary`, `/api/people/${b.code}/summary`]) {
      await call(who.uid, 'GET', url);
    }
  }
  assert.equal((await call(a.uid, 'PUT', '/api/data', { transactions: [tx()] })).status, 200);
  const data = (await call(b.uid, 'GET', '/api/data')).body;
  assert.deepEqual(Object.keys(data).sort(), ['cards', 'categories', 'payments', 'reserveMoves', 'reserves', 'transactions']);
  assert.deepEqual(data.transactions, []);
  const mine = (await call(a.uid, 'GET', '/api/data')).body;
  assert.equal(JSON.stringify(mine).includes('secret'), false);
  assert.equal(JSON.stringify(mine).includes(a.code), false);
});

const limitedApp = () =>
  buildApp({
    pool,
    verify: async (t) => {
      if (!t.startsWith('tok:')) throw new Error('bad token');
      return { uid: t.slice(4) };
    },
  });

test('looking a code up is limited to 20 a minute, so codes cannot be probed', async () => {
  const limited = await limitedApp();
  const uid = user();
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) statuses.push((await limited.inject({ method: 'GET', url: `/api/people/${NOBODY}`, headers: bearer(uid) })).statusCode);
  assert.ok(statuses.slice(0, 20).every((s) => s === 404));
  assert.equal(statuses[20], 429);
  assert.deepEqual((await limited.inject({ method: 'GET', url: `/api/people/${NOBODY}`, headers: bearer(uid) })).json(), { error: 'rate_limited' });
  await limited.close();
});

test('messages are limited to 30 a minute', async () => {
  const limited = await limitedApp();
  const a = await person();
  const b = await person();
  const statuses: number[] = [];
  for (let i = 0; i < 31; i++) {
    statuses.push((await limited.inject({ method: 'POST', url: '/api/messages', headers: bearer(a.uid), payload: { to: b.code, body: `m${i}` } })).statusCode);
  }
  assert.ok(statuses.slice(0, 30).every((s) => s === 201));
  assert.equal(statuses[30], 429);
  await limited.close();
});

test('CORS allows POST', async () => {
  const cors = await buildApp({ pool, allowedOrigins: ['http://localhost:8081'], verify: async () => ({ uid: 'x' }) });
  const r = await cors.inject({ method: 'OPTIONS', url: '/api/messages', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST' } });
  assert.match(String(r.headers['access-control-allow-methods']), /POST/);
  await cors.close();
});

test('summary: a category may carry a tone, and only a known one', async () => {
  const a = await person();
  const month = (tone: unknown) => summary({ categories: [{ slug: 'debts', label: 'Debts', pct: 10, tone }] });
  assert.equal((await call(a.uid, 'PUT', '/api/summary', month('unhealthy'))).status, 200);
  assert.equal((await call(a.uid, 'PUT', '/api/summary', month('tasty'))).status, 400);
  assert.equal((await call(a.uid, 'PUT', '/api/summary', month(7))).status, 400);
});
