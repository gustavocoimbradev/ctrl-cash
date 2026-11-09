import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db.js';
import { countryOf } from '../settings.js';
import { bearer, newUid, setup } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
before(async () => ({ app, pool } = await setup()));
after(async () => {
  await app.close();
  await pool.end();
});

const call = (uid: string | null, method: 'GET' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { ...(uid ? bearer(uid) : {}), ...headers }, payload: payload as object | undefined });

test('settings need a sign-in', async () => {
  assert.equal((await call(null, 'GET', '/api/settings')).statusCode, 401);
  assert.equal((await call(null, 'PUT', '/api/settings', { language: 'en', currency: 'USD' })).statusCode, 401);
  assert.equal((await call(null, 'GET', '/api/region')).statusCode, 401);
});

test('a new account has no settings, then saves and changes them', async () => {
  const uid = newUid();
  assert.deepEqual((await call(uid, 'GET', '/api/settings')).json(), { settings: null });
  assert.equal((await call(uid, 'PUT', '/api/settings', { language: 'pt', currency: 'BRL' })).statusCode, 200);
  assert.deepEqual((await call(uid, 'GET', '/api/settings')).json(), { settings: { language: 'pt', currency: 'BRL' } });
  await call(uid, 'PUT', '/api/settings', { language: 'de', currency: 'EUR' });
  assert.deepEqual((await call(uid, 'GET', '/api/settings')).json(), { settings: { language: 'de', currency: 'EUR' } });
});

test('settings are private to the account', async () => {
  const a = newUid();
  const b = newUid();
  await call(a, 'PUT', '/api/settings', { language: 'fr', currency: 'EUR' });
  assert.deepEqual((await call(b, 'GET', '/api/settings')).json(), { settings: null });
});

test('invalid settings are refused', async () => {
  const uid = newUid();
  for (const body of [
    { language: 'xx', currency: 'USD' },
    { language: 'en', currency: 'usd' },
    { language: 'en', currency: 'US' },
    { language: 'en' },
    { language: 'en', currency: 'USD', extra: 1 },
    [],
    'x',
  ]) {
    assert.equal((await call(uid, 'PUT', '/api/settings', body)).statusCode, 400, JSON.stringify(body));
  }
  assert.deepEqual((await call(uid, 'GET', '/api/settings')).json(), { settings: null });
});

test('the region comes from the edge header only', async () => {
  const uid = newUid();
  assert.deepEqual((await call(uid, 'GET', '/api/region', undefined, { 'cf-ipcountry': 'br' })).json(), { country: 'BR' });
  assert.deepEqual((await call(uid, 'GET', '/api/region')).json(), { country: null });
  assert.equal(countryOf({ 'cf-ipcountry': 'XX' }), null);
  assert.equal(countryOf({ 'cf-ipcountry': 'T1' }), null);
  assert.equal(countryOf({ 'cf-ipcountry': 'not a country' }), null);
});
