import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { createEmulatorVerifier, createFirebaseVerifier } from '../auth.js';
import { loadConfig } from '../config.js';

const PROJECT = 'demo-project';
let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let otherKey: CryptoKey;

before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig', kid: 'k1' }] });
});

const sign = (o: { aud?: string; iss?: string; sub?: string | null; exp?: string | number; key?: CryptoKey } = {}) => {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(o.aud ?? PROJECT).setIssuedAt().setExpirationTime(o.exp ?? '1h');
  if (o.sub !== null) jwt.setSubject(o.sub ?? 'user-1');
  return jwt.sign(o.key ?? privateKey);
};

test('real verifier: valid token', async () => {
  const v = createFirebaseVerifier(PROJECT, jwks);
  assert.deepEqual(await v(await sign()), { uid: 'user-1' });
});

test('real verifier: rejects wrong audience, issuer, expired, bad signature, no sub, garbage', async () => {
  const v = createFirebaseVerifier(PROJECT, jwks);
  await assert.rejects(v(await sign({ aud: 'other' })));
  await assert.rejects(v(await sign({ iss: 'https://securetoken.google.com/other' })));
  await assert.rejects(v(await sign({ exp: Math.floor(Date.now() / 1000) - 3600 })));
  await assert.rejects(v(await sign({ key: otherKey })));
  await assert.rejects(v(await sign({ sub: null })));
  await assert.rejects(v(await sign({ sub: '' })));
  await assert.rejects(v('not.a.jwt'));
});

test('real verifier: rejects an unsigned (alg none) token', async () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = `${b64({ alg: 'none' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'x', exp: 9999999999 })}.`;
  await assert.rejects(createFirebaseVerifier(PROJECT, jwks)(t));
});

test('emulator verifier: accepts unsigned tokens, still checks iss/aud/sub/exp', async () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mk = (p: object) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(p)}.`;
  const good = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'emu-1', exp: Math.floor(Date.now() / 1000) + 3600 };
  const v = createEmulatorVerifier(PROJECT);
  assert.deepEqual(await v(mk(good)), { uid: 'emu-1' });
  await assert.rejects(v(mk({ ...good, aud: 'x' })));
  await assert.rejects(v(mk({ ...good, iss: 'x' })));
  await assert.rejects(v(mk({ ...good, sub: '' })));
  await assert.rejects(v(mk({ ...good, exp: 1 })));
  await assert.rejects(v(mk({ ...good, exp: undefined })));
});

test('config: required vars and production + emulator is refused', () => {
  const base = { DATABASE_URL: 'postgres://x', FIREBASE_PROJECT_ID: PROJECT };
  assert.throws(() => loadConfig({ FIREBASE_PROJECT_ID: PROJECT }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x' }), /FIREBASE_PROJECT_ID/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR: '1' }), /forbidden/);
  const c = loadConfig({ ...base, FIREBASE_AUTH_EMULATOR: '1', ALLOWED_ORIGINS: 'http://localhost:8081, http://a.b' });
  assert.equal(c.emulator, true);
  assert.deepEqual(c.allowedOrigins, ['http://localhost:8081', 'http://a.b']);
  assert.equal(c.port, 3000);
  assert.equal(c.host, '0.0.0.0');
});
