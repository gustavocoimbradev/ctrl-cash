import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db.js';
import type { MailMessage } from '../email-report.js';
import { newUid, setup } from './helpers.js';

const sent: MailMessage[] = [];
let failNext = false;
let app: FastifyInstance;
let pool: Pool;
before(async () => {
  ({ app, pool } = await setup({
    mailer: {
      send: async (m) => {
        if (failNext) {
          failNext = false;
          throw new Error('smtp down');
        }
        sent.push(m);
      },
    },
  }));
});
after(async () => {
  await app.close();
  await pool.end();
});

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const auth = (uid: string, email?: string) => ({ authorization: `Bearer tok:${uid}${email ? `|${email}` : ''}` });

async function connect(uid: string, perms: Record<string, boolean>, email?: string) {
  const reg = (await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { client_name: 'Claude', redirect_uris: [REDIRECT] } as object })).json();
  const verifier = randomBytes(32).toString('base64url');
  const approve = await app.inject({ method: 'POST', url: '/api/oauth/approve', headers: auth(uid, email), payload: { client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...perms } as object });
  const code = new URL(approve.json().redirect).searchParams.get('code')!;
  const t = await app.inject({ method: 'POST', url: '/api/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }).toString() });
  return t.json().access_token as string;
}
const report = (over: Record<string, unknown> = {}) => ({
  subject: 'Fast food this week',
  title: 'Fast food, this week',
  subtitle: 'Nov 3 to Nov 9',
  blocks: [
    { type: 'metrics', items: [{ label: 'Spent', value: '$ 182.40', tone: 'bad' }, { label: 'Orders', value: '7' }] },
    { type: 'paragraph', text: 'You ordered 7 times.\nThat is more than last week.' },
    { type: 'table', columns: ['Day', 'Place', 'Amount'], rows: [['Mon', 'Burger <b>House</b>', '$ 32.00'], ['Tue', 'Pizza', '$ 41.50']] },
    { type: 'bars', items: [{ label: 'Mon', value: 32, display: '$ 32.00' }, { label: 'Tue', value: 41.5, display: '$ 41.50' }] },
    { type: 'list', items: ['Cook twice a week', 'Skip Friday'] },
  ],
  note: 'Numbers come from your transactions.',
  ...over,
});
const call = async (tok: string, args: unknown) =>
  (await app.inject({ method: 'POST', url: '/api/mcp', headers: { authorization: `Bearer ${tok}` }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_report_email', arguments: args } } as object })).json().result as { content: { text: string }[]; isError?: boolean };

test('a report is emailed only to the verified address of the account, in the Ctrl+Cash look', async () => {
  const uid = newUid();
  const tok = await connect(uid, { email: true }, 'ana@example.com');
  const r = await call(tok, report());
  assert.equal(r.isError, undefined, r.content[0]!.text);
  assert.match(r.content[0]!.text, /^Email sent to a\*\*\*@example\.com/);
  const mail = sent.at(-1)!;
  assert.equal(mail.to, 'ana@example.com');
  assert.equal(mail.subject, 'Ctrl+Cash: Fast food this week');
  assert.match(mail.html, /Ctrl\+Cash/);
  assert.match(mail.html, /#2D55D9/);
  assert.match(mail.html, /Fast food, this week/);
  assert.match(mail.text, /Spent: \$ 182\.40/);
  // what the assistant wrote is text: nothing in it becomes markup
  assert.ok(mail.html.includes('Burger &lt;b&gt;House&lt;/b&gt;'));
  assert.ok(!mail.html.includes('<b>House'));
  // the footer follows the person's language
  await pool.query("insert into settings (user_id, language, currency) values ($1, 'pt', 'BRL')", [uid]);
  await call(tok, report());
  assert.match(sent.at(-1)!.html, /Feito pelo Claude a seu pedido/);
});

test('the assistant cannot choose a recipient, and needs the permission and a verified address', async () => {
  const uid = newUid();
  const noPerm = await connect(uid, {}, 'a@example.com');
  assert.equal((await call(noPerm, report())).isError, true);
  assert.match((await call(noPerm, report())).content[0]!.text, /may not email/);

  const noAddress = await connect(newUid(), { email: true });
  const r = await call(noAddress, report());
  // approving without a verified address cannot switch emailing on
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /may not email/);

  const before = sent.length;
  const tok = await connect(newUid(), { email: true }, 'b@example.com');
  // an extra "to" is refused as an unknown argument by the schema, and is never used
  const res = await call(tok, report({ to: 'attacker@evil.com' }));
  assert.ok(sent.slice(before).every((m) => m.to === 'b@example.com'));
  void res;
});

test('the report is checked and limited', async () => {
  const tok = await connect(newUid(), { email: true }, 'c@example.com');
  const before = sent.length;
  for (const bad of [
    report({ subject: '' }),
    report({ blocks: [] }),
    report({ blocks: [{ type: 'script', text: 'x' }] }),
    report({ blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['only one']] }] }),
    report({ blocks: [{ type: 'bars', items: [{ label: 'x', value: -3 }] }] }),
    report({ blocks: Array.from({ length: 41 }, () => ({ type: 'paragraph', text: 'x' })) }),
    report({ blocks: [{ type: 'paragraph', text: 'x'.repeat(2001) }] }),
    report({ subject: 'x'.repeat(121) }),
  ]) {
    const r = await call(tok, bad);
    assert.equal(r.isError, true, JSON.stringify(bad).slice(0, 80));
    assert.match(r.content[0]!.text, /^Not done: /);
  }
  assert.equal(sent.length, before);
  // a line break in the subject cannot add a header
  await call(tok, report({ subject: 'Hi\r\nBcc: x@evil.com' }));
  assert.ok(!/[\r\n]/.test(sent.at(-1)!.subject));
  // three an hour (the line-break one above was the first)
  await call(tok, report());
  await call(tok, report());
  const fourth = await call(tok, report());
  assert.equal(fourth.isError, true);
  assert.match(fourth.content[0]!.text, /at most 3 emails an hour/);
});

test('a failing mail server is reported, and email can be turned off', async () => {
  const uid = newUid();
  const tok = await connect(uid, { email: true }, 'd@example.com');
  failNext = true;
  const r = await call(tok, report());
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /could not be sent/);
  const [conn] = (await app.inject({ method: 'GET', url: '/api/assistant/connections', headers: auth(uid, 'd@example.com') })).json().connections;
  assert.equal(conn.canEmail, true);
  assert.equal(conn.email, 'd@example.com');
  await app.inject({ method: 'POST', url: '/api/assistant/connections/permissions', headers: auth(uid, 'd@example.com'), payload: { id: conn.id, email: false } as object });
  assert.equal((await call(tok, report())).isError, true);
  // allowing it again needs a verified address on the account
  assert.equal((await app.inject({ method: 'POST', url: '/api/assistant/connections/permissions', headers: auth(uid), payload: { id: conn.id, email: true } as object })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/assistant/connections/permissions', headers: auth(uid, 'd2@example.com'), payload: { id: conn.id, email: true } as object })).statusCode, 200);
  assert.equal((await call(tok, report())).isError, undefined);
  assert.equal(sent.at(-1)!.to, 'd2@example.com');
});
