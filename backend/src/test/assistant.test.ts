import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
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

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const HOST = { host: 'cash.example.com', 'x-forwarded-proto': 'https' };
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const newVerifier = () => randomBytes(32).toString('base64url');

async function register(redirect_uris: unknown = [REDIRECT]) {
  const r = await app.inject({ method: 'POST', url: '/api/oauth/register', headers: HOST, payload: { client_name: 'Claude', redirect_uris } as object });
  return { status: r.statusCode, body: r.json() as any };
}
async function token(form: Record<string, string>) {
  const r = await app.inject({ method: 'POST', url: '/api/oauth/token', headers: { ...HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(form).toString() });
  return { status: r.statusCode, body: r.json() as any, headers: r.headers };
}
/** the whole way in: register, approve as `uid`, exchange the code */
async function connect(uid: string, write = false) {
  const reg = await register();
  const verifier = newVerifier();
  const approve = await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: bearer(uid), payload: { client_id: reg.body.client_id, redirect_uri: REDIRECT, state: 'xyz', code_challenge: challengeOf(verifier), write } as object });
  assert.equal(approve.statusCode, 200);
  const redirect = new URL(approve.json().redirect);
  assert.equal(redirect.origin + redirect.pathname, REDIRECT);
  assert.equal(redirect.searchParams.get('state'), 'xyz');
  const code = redirect.searchParams.get('code')!;
  const t = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: REDIRECT });
  assert.equal(t.status, 200);
  return { clientId: reg.body.client_id as string, verifier, code, tokens: t.body as { access_token: string; refresh_token: string; expires_in: number } };
}
const mcp = (accessToken: string | null, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/mcp', headers: { ...HOST, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, payload: payload as object });

test('discovery documents point at this site', async () => {
  const prm = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/api/mcp', headers: HOST });
  assert.deepEqual(prm.json().authorization_servers, ['https://cash.example.com']);
  assert.equal(prm.json().resource, 'https://cash.example.com/api/mcp');
  const as = (await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: HOST })).json();
  assert.equal(as.token_endpoint, 'https://cash.example.com/api/oauth/token');
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.ok(as.registration_endpoint.endsWith('/api/oauth/register'));
});

test('client registration only takes safe redirect addresses', async () => {
  assert.equal((await register()).status, 201);
  assert.equal((await register(['http://localhost:6274/callback'])).status, 201);
  for (const bad of [[], ['http://evil.example.com/cb'], ['javascript:alert(1)'], ['https://a.example.com/cb#frag'], 'x', ['https://a.example.com/1', 'https://a.example.com/2', 'https://a.example.com/3', 'https://a.example.com/4', 'https://a.example.com/5', 'https://a.example.com/6']]) {
    assert.equal((await register(bad)).status, 400, JSON.stringify(bad));
  }
});

test('the authorization request goes to the consent page, only for registered redirects', async () => {
  const reg = await register();
  const challenge = challengeOf(newVerifier());
  const q = (over: Record<string, string> = {}) => new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's1', ...over }).toString();
  const ok = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${q()}`, headers: HOST });
  assert.equal(ok.statusCode, 302);
  const to = new URL(ok.headers.location as string);
  assert.equal(to.origin + to.pathname, 'https://cash.example.com/connect');
  assert.equal(to.searchParams.get('state'), 's1');
  // an unknown redirect is never followed
  assert.equal((await app.inject({ method: 'GET', url: `/api/oauth/authorize?${q({ redirect_uri: 'https://evil.example.com/cb' })}`, headers: HOST })).statusCode, 400);
  // no PKCE: sent back to the client with an error
  const noPkce = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${q({ code_challenge_method: 'plain' })}`, headers: HOST });
  assert.equal(noPkce.statusCode, 302);
  assert.equal(new URL(noPkce.headers.location as string).searchParams.get('error'), 'invalid_request');
});

test('approving needs a signed-in person; the code works once and only with the right verifier', async () => {
  const reg = await register();
  const verifier = newVerifier();
  const body = { client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challengeOf(verifier) };
  assert.equal((await app.inject({ method: 'POST', url: '/api/oauth/approve', payload: body })).statusCode, 401);
  const uid = newUid();
  const code = new URL((await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: bearer(uid), payload: body })).json().redirect).searchParams.get('code')!;
  const exchange = (v: string, redirect = REDIRECT) => token({ grant_type: 'authorization_code', code, code_verifier: v, client_id: reg.body.client_id, redirect_uri: redirect });
  // a wrong verifier burns the code: it cannot be tried again
  assert.equal((await exchange(newVerifier())).body.error, 'invalid_grant');
  assert.equal((await exchange(verifier)).body.error, 'invalid_grant');

  const code2 = new URL((await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: bearer(uid), payload: body })).json().redirect).searchParams.get('code')!;
  const good = await token({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: REDIRECT });
  assert.equal(good.status, 200);
  assert.equal(good.headers['cache-control'], 'no-store');
  assert.equal(good.body.token_type, 'Bearer');
  // used already
  assert.equal((await token({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: REDIRECT })).body.error, 'invalid_grant');
  // other things are refused
  assert.equal((await token({ grant_type: 'password' })).body.error, 'unsupported_grant_type');
  assert.equal((await token({ grant_type: 'authorization_code', code: 'nope', code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: REDIRECT })).body.error, 'invalid_grant');
});

test('an expired code is refused', async () => {
  const reg = await register();
  const verifier = newVerifier();
  const approve = await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: bearer(newUid()), payload: { client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challengeOf(verifier) } as object });
  const code = new URL(approve.json().redirect).searchParams.get('code')!;
  await pool.query('update oauth_codes set expires_at_ms = 1 where client_id = $1', [reg.body.client_id]);
  assert.equal((await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: REDIRECT })).body.error, 'invalid_grant');
});

test('denying sends the client back with access_denied', async () => {
  const reg = await register();
  const r = await app.inject({ method: 'POST', url: '/api/oauth/deny', headers: bearer(newUid()), payload: { client_id: reg.body.client_id, redirect_uri: REDIRECT, state: 'q' } as object });
  const to = new URL(r.json().redirect);
  assert.equal(to.searchParams.get('error'), 'access_denied');
  assert.equal(to.searchParams.get('state'), 'q');
});

test('MCP: it needs a token and says where to get one', async () => {
  const r = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.equal(r.statusCode, 401);
  assert.match(String(r.headers['www-authenticate']), /resource_metadata="https:\/\/cash\.example\.com\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  assert.equal((await mcp('ccat_made_up', { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/mcp', headers: HOST })).statusCode, 405);
});

test('MCP: initialize, list the tools and read only my own snapshot', async () => {
  const me = newUid();
  const other = newUid();
  const a = await connect(me);
  const b = await connect(other);

  const init = (await mcp(a.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } } })).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.match(init.result.instructions, /Ctrl\+Cash assistant guide/);
  assert.equal((await mcp(a.tokens.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode, 202);

  const list = (await mcp(a.tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.ok(list.result.tools.length >= 8);
  // everything only reads, except adding a transaction (refused unless the person allowed it)
  assert.deepEqual(list.result.tools.filter((t: any) => t.annotations.readOnlyHint !== true).map((t: any) => t.name), ['add_transaction']);

  const call = (tok: string, name: string) => mcp(tok, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: {} } }).then((r) => r.json());
  // nothing published yet
  assert.match((await call(a.tokens.access_token, 'get_overview')).result.content[0].text, /no data yet/i);

  const put = (uid: string, snapshot: object) => app.inject({ method: 'PUT', url: '/api/assistant/snapshot', headers: bearer(uid), payload: snapshot });
  assert.equal((await put(me, { version: 1, currency: 'BRL', generatedAt: 1, overview: { balance: 123.45 } })).statusCode, 200);
  assert.equal((await put(other, { version: 1, currency: 'USD', generatedAt: 2, overview: { balance: 999 } })).statusCode, 200);
  const mine = JSON.parse((await call(a.tokens.access_token, 'get_overview')).result.content[0].text);
  assert.deepEqual(mine.overview, { balance: 123.45 });
  assert.equal(mine.currency, 'BRL');
  assert.equal(JSON.parse((await call(b.tokens.access_token, 'get_overview')).result.content[0].text).overview.balance, 999);
  assert.equal((await mcp(a.tokens.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_everything' } })).json().error.code, -32602);
  assert.equal((await mcp(a.tokens.access_token, { jsonrpc: '2.0', id: 5, method: 'nope' })).json().error.code, -32601);
});

test('snapshots are validated and only kept while somebody is connected', async () => {
  const uid = newUid();
  const put = (snapshot: unknown) => app.inject({ method: 'PUT', url: '/api/assistant/snapshot', headers: bearer(uid), payload: snapshot as object });
  assert.equal((await put({ version: 1 })).statusCode, 409);
  await connect(uid);
  assert.equal((await put({ version: 2 })).statusCode, 400);
  assert.equal((await put([])).statusCode, 400);
  assert.equal((await put({ version: 1, big: 'x'.repeat(400_001) })).statusCode, 400);
  assert.equal((await put({ version: 1 })).statusCode, 200);
});

test('refresh tokens rotate, and reusing an old one cuts the connection', async () => {
  const uid = newUid();
  const c = await connect(uid);
  const r1 = await token({ grant_type: 'refresh_token', refresh_token: c.tokens.refresh_token });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.access_token, c.tokens.access_token);
  assert.equal((await mcp(r1.body.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode, 200);
  // the first refresh token is spent: showing it again revokes everything
  assert.equal((await token({ grant_type: 'refresh_token', refresh_token: c.tokens.refresh_token })).body.error, 'invalid_grant');
  assert.equal((await mcp(r1.body.access_token, { jsonrpc: '2.0', id: 2, method: 'ping' })).statusCode, 401);
  assert.equal((await token({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token })).body.error, 'invalid_grant');
});

test('connections: listed for their owner only, and revoking stops the access at once', async () => {
  const me = newUid();
  const other = newUid();
  const c = await connect(me);
  const list = async (uid: string) => (await app.inject({ method: 'GET', url: '/api/assistant/connections', headers: { ...bearer(uid), ...HOST } })).json();
  const mine = await list(me);
  assert.equal(mine.connections.length, 1);
  assert.equal(mine.connections[0].name, 'Claude');
  assert.equal(mine.mcpUrl, 'https://cash.example.com/api/mcp');
  assert.equal((await list(other)).connections.length, 0);
  // somebody else cannot revoke mine
  await app.inject({ method: 'POST', url: '/api/assistant/connections/revoke', headers: bearer(other), payload: { id: mine.connections[0].id } });
  assert.equal((await mcp(c.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/assistant/connections/revoke', headers: bearer(me), payload: { id: mine.connections[0].id } })).statusCode, 200);
  assert.equal((await mcp(c.tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'ping' })).statusCode, 401);
  assert.equal((await list(me)).connections.length, 0);
  // revoked, not deleted
  const kept = await pool.query('select revoked_at_ms from assistant_connections where id = $1', [mine.connections[0].id]);
  assert.ok(kept.rows[0].revoked_at_ms);
});

test('connecting again replaces the earlier connection of the same assistant', async () => {
  const uid = newUid();
  const first = await connect(uid);
  const reg = await register();
  const verifier = newVerifier();
  const approve = await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: bearer(uid), payload: { client_id: first.clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(verifier) } as object });
  assert.equal(approve.statusCode, 200);
  const live = await pool.query('select count(*)::int as n from assistant_connections where user_id = $1 and client_id = $2 and revoked_at_ms is null', [uid, first.clientId]);
  assert.equal(live.rows[0].n, 1);
  assert.equal((await mcp(first.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode, 401);
  void reg;
});

const callTool = async (tok: string, name: string, args: unknown = {}) => (await mcp(tok, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).json().result as { content: { text: string }[]; isError?: boolean };

test('adding transactions: read-only by default, allowed by the person, then made the way the app makes them', async () => {
  const uid = newUid();
  const c = await connect(uid);
  const add = (args: unknown) => callTool(c.tokens.access_token, 'add_transaction', args);
  const docs = async () => (await app.inject({ method: 'GET', url: '/api/data', headers: bearer(uid) })).json().transactions as any[];

  // the tool is listed with its schema, and refused while the connection is read-only
  const list = (await mcp(c.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools;
  assert.equal(list.find((t: any) => t.name === 'add_transaction').annotations.readOnlyHint, false);
  const refused = await add({ type: 'expense', description: 'Pharmacy', amount: 30 });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0]!.text, /read-only/);
  assert.equal((await docs()).length, 0);

  // somebody else cannot allow it for me; I can
  const [conn] = (await app.inject({ method: 'GET', url: '/api/assistant/connections', headers: { ...bearer(uid), ...HOST } })).json().connections;
  assert.equal(conn.canWrite, false);
  const allow = (who: string, write: boolean) => app.inject({ method: 'POST', url: '/api/assistant/connections/permissions', headers: bearer(who), payload: { id: conn.id, write } as object });
  assert.equal((await allow(newUid(), true)).statusCode, 404);
  assert.equal((await allow(uid, true)).statusCode, 200);

  // an expense: whole units in, the smallest unit stored; already paid by default
  const ok = await add({ type: 'expense', description: 'Pharmacy', amount: 49.9, date: '2026-11-05', category: 'Health' });
  assert.equal(ok.isError, undefined, ok.content[0]!.text);
  const [t1] = await docs();
  assert.equal(t1.amount, 4990);
  assert.equal(t1.category, 'health');
  assert.equal(t1.confirmed, true);
  assert.equal(t1.date, '2026-11-05');
  assert.equal(t1.fixed, false);

  // income needs a category; pending when asked
  assert.equal((await add({ type: 'income', description: 'Pay', amount: 1000 })).isError, true);
  assert.equal((await add({ type: 'income', description: 'Pay', amount: 1000, category: 'salary', confirmed: false })).isError, undefined);

  // a card purchase in 3 installments: split, on the following invoices, never confirmed
  await app.inject({ method: 'PUT', url: '/api/data', headers: bearer(uid), payload: { cards: [{ id: 'k1', name: 'Nubank', limit: 500000, dueDay: 10 }] } as object });
  const card = await add({ type: 'expense', description: 'Phone', amount: 1000, date: '2026-11-05', card: 'nubank', installments: 3 });
  assert.equal(card.isError, undefined, card.content[0]!.text);
  const phone = (await docs()).filter((d) => d.description === 'Phone').sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(phone.length, 3);
  assert.deepEqual(phone.map((d) => d.amount), [33334, 33333, 33333]);
  assert.deepEqual(phone.map((d) => d.invoiceKey), ['2026-12', '2027-01', '2027-02']);
  assert.ok(phone.every((d) => d.confirmed === false && d.cardId === 'k1' && d.installment.total === 3));
  assert.equal(new Set(phone.map((d) => d.installment.groupId)).size, 1);

  // monthly (fixed)
  assert.equal((await add({ type: 'expense', description: 'Rent', amount: 800, fixed: true, category: 'bills' })).isError, undefined);
  assert.equal((await docs()).find((d) => d.description === 'Rent').fixed, true);

  // what is wrong is refused with a reason, and nothing is written
  const before = (await docs()).length;
  for (const bad of [
    { type: 'expense', description: 'x', amount: -5 },
    { type: 'expense', description: 'x', amount: 'ten' },
    { type: 'transfer', description: 'x', amount: 5 },
    { type: 'expense', description: '', amount: 5 },
    { type: 'expense', description: 'x', amount: 5, category: 'nonsense' },
    { type: 'expense', description: 'x', amount: 5, card: 'ghost' },
    { type: 'expense', description: 'x', amount: 5, date: '2099-01-01' },
    { type: 'expense', description: 'x', amount: 5, date: 'yesterday' },
    { type: 'expense', description: 'x', amount: 5, installments: 99 },
    { type: 'expense', description: 'x', amount: 5, fixed: true, installments: 3 },
    { type: 'income', description: 'x', amount: 5, category: 'salary', card: 'Nubank' },
  ]) {
    const r = await add(bad);
    assert.equal(r.isError, true, JSON.stringify(bad));
    assert.match(r.content[0]!.text, /^Not done: /);
  }
  assert.equal((await docs()).length, before);

  // and read-only again stops it at once
  assert.equal((await allow(uid, false)).statusCode, 200);
  assert.equal((await add({ type: 'expense', description: 'Again', amount: 5 })).isError, true);
});

test('list_categories_and_cards names what can be used', async () => {
  const uid = newUid();
  const c = await connect(uid);
  await app.inject({ method: 'PUT', url: '/api/data', headers: bearer(uid), payload: { cards: [{ id: 'k1', name: 'Nubank', limit: 1000, dueDay: 9 }], categories: [{ id: 'c1', slug: 'c1', kind: 'expense', name: 'Coffee', weight: 0.5 }] } as object });
  const r = JSON.parse((await callTool(c.tokens.access_token, 'list_categories_and_cards')).content[0]!.text);
  assert.ok(r.expenseCategories.some((x: any) => x.slug === 'groceries'));
  assert.ok(r.expenseCategories.some((x: any) => x.name === 'Coffee'));
  assert.ok(r.incomeCategories.some((x: any) => x.slug === 'salary'));
  assert.deepEqual(r.cards, [{ name: 'Nubank', dueDay: 9 }]);
});
