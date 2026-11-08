import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE_ALPHABET, CODE_RE, DIGITS, generateCode, isCode, normalizeCode } from '../code.js';

const never = async () => false;

test('the alphabet has 34 symbols, no I and no O, and the regex matches it', () => {
  assert.equal(CODE_ALPHABET.length, 34);
  assert.equal(new Set(CODE_ALPHABET).size, 34);
  assert.ok(!CODE_ALPHABET.includes('I') && !CODE_ALPHABET.includes('O'));
  assert.ok(CODE_ALPHABET.startsWith(DIGITS));
  for (const c of ['482913', '7Q2K9M', 'ABCDEF', '000000', 'Z9Z9Z9']) assert.ok(CODE_RE.test(c), c);
  for (const c of ['', '12345', '1234567', 'ABCDEI', 'ABCDEO', '12345a', '12 456', '12-456', '12345\n', 'ÁBCDEF']) assert.ok(!CODE_RE.test(c), c);
  assert.equal(isCode(482913), false);
});

test('normalizeCode: any case in, upper case out, anything else is null', () => {
  assert.equal(normalizeCode('7q2k9m'), '7Q2K9M');
  assert.equal(normalizeCode('482913'), '482913');
  for (const v of ['7q2k9', '7q2k9mm', 'ioiooi', '', null, undefined, 5, {}, ['482913']]) assert.equal(normalizeCode(v), null, String(v));
});

test('generator: digits only while there is room, always the 6-character format', async () => {
  for (let i = 0; i < 300; i++) {
    const code = await generateCode({ exists: never });
    assert.match(code, /^[0-9]{6}$/);
    assert.ok(CODE_RE.test(code));
  }
});

test('generator: it asks for up to 20 digit-only codes, then falls back to a code with a letter', async () => {
  let asked = 0;
  const crowded = async (c: string) => {
    asked++;
    return /^[0-9]+$/.test(c);
  };
  const code = await generateCode({ exists: crowded });
  assert.equal(asked, 21);
  assert.ok(CODE_RE.test(code));
  assert.match(code, /[A-HJ-NP-Z]/);
  // many runs: the fallback never returns an all-digit code, and I and O never appear
  for (let i = 0; i < 200; i++) {
    const c = await generateCode({ exists: async (x) => /^[0-9]+$/.test(x) });
    assert.match(c, /[A-HJ-NP-Z]/);
    assert.ok(!/[IO]/.test(c));
  }
  // a free digits-only code found on the 3rd try is used, with no fallback
  let n = 0;
  const third = await generateCode({ exists: async () => ++n < 3 });
  assert.equal(n, 3);
  assert.match(third, /^[0-9]{6}$/);
});

test('generator: an all-digit draw in the lettered tier is redrawn', async () => {
  // digit tier is skipped (0 attempts); the source first draws 6 digits, then a lettered code
  const draws = [1, 1, 1, 1, 1, 1, 10, 11, 12, 13, 14, 15];
  let i = 0;
  const code = await generateCode({ digitAttempts: 0, exists: never, random: (max) => draws[i++]! % max });
  assert.equal(code, 'ABCDEF'.replace('ABCDEF', CODE_ALPHABET.slice(10, 16)));
  assert.equal(i, 12);
});

test('generator: it really uses the random source (nothing fixed or sequential)', async () => {
  const picks: number[] = [];
  const code = await generateCode({
    exists: never,
    random: (max) => {
      const v = (picks.length * 3) % max;
      picks.push(v);
      return v;
    },
  });
  assert.equal(picks.length, 6);
  assert.equal(code, '036925');
  assert.ok(picks.every((v) => v >= 0 && v < 10));
});

test('generator: throws instead of looping forever when nothing is free', async () => {
  await assert.rejects(generateCode({ exists: async () => true, mixedAttempts: 5 }), /no free code/);
});

test('generator: with real randomness the codes are spread out and not sequential', async () => {
  const codes: string[] = [];
  for (let i = 0; i < 2000; i++) codes.push(await generateCode({ exists: never }));
  assert.ok(new Set(codes).size > 1990, 'almost no repeats in 2000 draws out of a million');
  let steps = 0;
  for (let i = 1; i < codes.length; i++) if (Math.abs(Number(codes[i]) - Number(codes[i - 1])) === 1) steps++;
  assert.ok(steps < 5, `consecutive codes should not step by one (${steps})`);
  // every digit shows up in every position, so no position is fixed
  for (let pos = 0; pos < 6; pos++) assert.equal(new Set(codes.map((c) => c[pos])).size, 10);
  // the lettered tier covers the whole alphabet
  const mixed = new Set<string>();
  for (let i = 0; i < 400; i++) for (const ch of await generateCode({ exists: async (x) => /^[0-9]+$/.test(x) })) mixed.add(ch);
  assert.equal(mixed.size, 34);
});
