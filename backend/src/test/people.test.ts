import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db.js';
import { bearer, newUid, setup } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
before(async () => ({ app, pool } = await setup()));
after(async () => {
  await app.close();
  await pool.end();
});

const tag = `T${Date.now().toString(36)}`.toUpperCase();
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';
type Listed = { code: string; displayName: string; photo: string | null; related: boolean };

async function person(name: string, extra: Record<string, unknown> = {}) {
  const uid = newUid();
  const r = await app.inject({ method: 'PUT', url: '/api/profile', headers: bearer(uid), payload: { displayName: name, ...extra } as object });
  assert.equal(r.statusCode, 200, r.body);
  return { uid, code: r.json().profile.code as string };
}
const people = async (uid: string, q = '', offset = 0) => {
  const r = await app.inject({ method: 'GET', url: `/api/people?q=${encodeURIComponent(q)}&offset=${offset}`, headers: bearer(uid) });
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { people: Listed[]; more: boolean };
};

test('the list needs a sign-in, leaves me out and never shows a user id', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/people' })).statusCode, 401);
  const me = await person(`${tag} Me`);
  const other = await person(`${tag} Other`);
  const res = await app.inject({ method: 'GET', url: `/api/people?q=${tag}`, headers: bearer(me.uid) });
  assert.ok(!res.body.includes(me.uid) && !res.body.includes(other.uid));
  const list = res.json().people as Listed[];
  assert.ok(list.some((p) => p.code === other.code));
  assert.ok(!list.some((p) => p.code === me.code));
});

test('people I talk to or share with come first, and only they bring a photo', async () => {
  const me = await person(`${tag} Zed`);
  const chat = await person(`${tag} Chatty`, { photo: JPEG });
  const share = await person(`${tag} Sharer`, { photo: JPEG });
  const mine = await person(`${tag} Mine`, { photo: JPEG });
  const stranger = await person(`${tag} Aaron`, { photo: JPEG });
  await app.inject({ method: 'POST', url: '/api/messages', headers: bearer(me.uid), payload: { to: chat.code, body: 'hi' } as object });
  await app.inject({ method: 'POST', url: '/api/shares', headers: bearer(share.uid), payload: { code: me.code } as object });
  await app.inject({ method: 'POST', url: '/api/shares', headers: bearer(me.uid), payload: { code: mine.code } as object });
  const { people: list } = await people(me.uid, tag);
  const order = list.map((p) => p.code);
  const related = [chat.code, share.code, mine.code];
  assert.deepEqual(new Set(order.slice(0, 3)), new Set(related));
  assert.equal(order[3], stranger.code);
  assert.ok(list.slice(0, 3).every((p) => p.related && p.photo === JPEG));
  assert.equal(list[3]!.related, false);
  assert.equal(list[3]!.photo, null);
});

test('search finds by part of a name (any case) or by a code', async () => {
  const me = await person(`${tag} Searcher`);
  const maria = await person(`${tag} Maria Souza`);
  const joao = await person(`${tag} João Pereira`);
  const names = async (q: string) => (await people(me.uid, q)).people.map((p) => p.displayName);
  assert.deepEqual(await names(`${tag} maria`), [`${tag} Maria Souza`]);
  assert.deepEqual((await names(`pereira`)).filter((n) => n.startsWith(tag)), [`${tag} João Pereira`]);
  assert.deepEqual((await people(me.uid, joao.code.toLowerCase())).people.map((p) => p.code), [joao.code]);
  assert.deepEqual((await people(me.uid, maria.code)).people.map((p) => p.code), [maria.code]);
  assert.deepEqual((await people(me.uid, `${tag} nobody-like-this`)).people, []);
});

test('a wildcard in the search is plain text, not "everybody"', async () => {
  const me = await person(`${tag} Wild`);
  await person(`${tag} Plain`);
  assert.deepEqual((await people(me.uid, '%')).people.filter((p) => p.displayName.startsWith(tag)), []);
  assert.deepEqual((await people(me.uid, '_')).people.filter((p) => p.displayName.startsWith(tag)), []);
  assert.deepEqual((await people(me.uid, '\\')).people.filter((p) => p.displayName.startsWith(tag)), []);
});

test('somebody who turned discovery off is found only by their exact code, or by people they already know', async () => {
  const me = await person(`${tag} Looker`);
  const hidden = await person(`${tag} Hidden`, { discoverable: false });
  const friend = await person(`${tag} Friend`, { discoverable: false });
  assert.ok(!(await people(me.uid, `${tag} Hidden`)).people.some((p) => p.code === hidden.code));
  assert.deepEqual((await people(me.uid, hidden.code)).people.map((p) => p.code), [hidden.code]);
  // somebody I talk to stays in my list even if they hid themselves
  await app.inject({ method: 'POST', url: '/api/messages', headers: bearer(me.uid), payload: { to: friend.code, body: 'hey' } as object });
  const found = (await people(me.uid, `${tag} Friend`)).people;
  assert.equal(found[0]?.code, friend.code);
  assert.equal(found[0]?.related, true);
  // and it can be turned back on
  const mine = await app.inject({ method: 'GET', url: '/api/profile', headers: bearer(hidden.uid) });
  assert.equal(mine.json().profile.discoverable, false);
  await app.inject({ method: 'PUT', url: '/api/profile', headers: bearer(hidden.uid), payload: { displayName: `${tag} Hidden`, discoverable: true } as object });
  assert.ok((await people(me.uid, `${tag} Hidden`)).people.some((p) => p.code === hidden.code));
  assert.equal((await app.inject({ method: 'PUT', url: '/api/profile', headers: bearer(hidden.uid), payload: { displayName: 'x', discoverable: 'yes' } as object })).statusCode, 400);
});

test('the list is paged', async () => {
  const me = await person(`${tag} Pager`);
  for (let i = 0; i < 23; i++) await person(`${tag} Page ${String(i).padStart(2, '0')}`);
  const first = await people(me.uid, `${tag} Page`);
  assert.equal(first.people.length, 20);
  assert.equal(first.more, true);
  const second = await people(me.uid, `${tag} Page`, 20);
  assert.equal(second.people.length, 3);
  assert.equal(second.more, false);
  assert.equal(new Set([...first.people, ...second.people].map((p) => p.code)).size, 23);
});
