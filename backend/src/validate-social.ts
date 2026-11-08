// Validators for the social routes, in the style of validate.ts: hand written, strict, no unknown fields.
import { ValidationError, type Doc } from './validate.js';

const fail = (message: string): never => {
  throw new ValidationError(message);
};

const MAX_ABS = 100_000_000_000;
export const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const strLen = (s: string) => [...s].length;
const isObject = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (d: Doc, k: string) => Object.prototype.hasOwnProperty.call(d, k);

function obj(v: unknown, what: string): Doc {
  return isObject(v) ? v : fail(`${what} must be an object`);
}

function onlyKeys(d: Doc, allowed: string[], required: string[]) {
  for (const k of Object.keys(d)) if (!allowed.includes(k)) fail(`unknown field "${k}"`);
  for (const k of required) if (!has(d, k)) fail(`missing field "${k}"`);
}

function str(v: unknown, name: string, min: number, max: number): string {
  if (typeof v !== 'string') return fail(`"${name}" must be a string`);
  if (v.includes('\u0000')) fail(`"${name}" contains an invalid character`);
  const n = strLen(v);
  if (n < min || n > max) fail(`"${name}" must be ${min} to ${max} characters`);
  return v;
}

function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return fail(`"${name}" must be an integer from ${min} to ${max}`);
  return v;
}

/** A handle as typed in a body or a URL: lower-case letters, digits and underscore, 3 to 24 characters. */
export function parseHandle(v: unknown, name = 'handle'): string {
  if (typeof v !== 'string' || !HANDLE_RE.test(v)) return fail(`"${name}" must match ${HANDLE_RE.source}`);
  return v;
}

/** `{ handle }` and nothing else. */
export function parseHandleBody(input: unknown, key = 'handle'): string {
  const d = obj(input, 'the body');
  onlyKeys(d, [key], [key]);
  return parseHandle(d[key], key);
}

export interface ProfileInput {
  handle: string;
  displayName: string;
  bio: string | null;
  color: string | null;
}

export function parseProfile(input: unknown): ProfileInput {
  const d = obj(input, 'the body');
  onlyKeys(d, ['handle', 'displayName', 'bio', 'color'], ['handle', 'displayName']);
  const handle = parseHandle(d.handle);
  const displayName = str(d.displayName, 'displayName', 1, 40);
  if (displayName.trim().length === 0) fail('"displayName" cannot be blank');
  let bio: string | null = null;
  if (has(d, 'bio') && d.bio !== null) {
    const b = str(d.bio, 'bio', 0, 160).trim();
    bio = b.length > 0 ? b : null;
  }
  let color: string | null = null;
  if (has(d, 'color') && d.color !== null) {
    if (typeof d.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(d.color)) fail('"color" must be a color as #RRGGBB');
    color = d.color as string;
  }
  return { handle, displayName: displayName.trim(), bio, color };
}

export function parseMessage(input: unknown): { to: string; body: string } {
  const d = obj(input, 'the body');
  onlyKeys(d, ['to', 'body'], ['to', 'body']);
  const to = parseHandle(d.to, 'to');
  if (typeof d.body !== 'string') fail('"body" must be a string');
  const body = (d.body as string).trim();
  str(body, 'body', 1, 1000);
  return { to, body };
}

export interface Summary {
  version: 1;
  generatedAt: number;
  months: { key: string; income: number; expense: number; left: number }[];
  categories: { slug: string; label: string; amount: number }[];
}

export function parseSummary(input: unknown): Summary {
  const d = obj(input, 'the body');
  onlyKeys(d, ['version', 'generatedAt', 'months', 'categories'], ['version', 'generatedAt', 'months', 'categories']);
  if (d.version !== 1) fail('"version" must be 1');
  const generatedAt = int(d.generatedAt, 'generatedAt', 0, 100_000_000_000_000);
  if (!Array.isArray(d.months) || d.months.length > 24) fail('"months" must be a list of at most 24 items');
  if (!Array.isArray(d.categories) || d.categories.length > 40) fail('"categories" must be a list of at most 40 items');
  const seen = new Set<string>();
  const months = (d.months as unknown[]).map((raw, i) => {
    const m = obj(raw, `months[${i}]`);
    onlyKeys(m, ['key', 'income', 'expense', 'left'], ['key', 'income', 'expense', 'left']);
    if (typeof m.key !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(m.key)) fail(`months[${i}].key must be a month as YYYY-MM`);
    if (seen.has(m.key as string)) fail(`months[${i}].key is repeated`);
    seen.add(m.key as string);
    return {
      key: m.key as string,
      income: int(m.income, `months[${i}].income`, 0, MAX_ABS),
      expense: int(m.expense, `months[${i}].expense`, 0, MAX_ABS),
      left: int(m.left, `months[${i}].left`, -MAX_ABS, MAX_ABS),
    };
  });
  const categories = (d.categories as unknown[]).map((raw, i) => {
    const c = obj(raw, `categories[${i}]`);
    onlyKeys(c, ['slug', 'label', 'amount'], ['slug', 'label', 'amount']);
    return {
      slug: str(c.slug, `categories[${i}].slug`, 1, 40),
      label: str(c.label, `categories[${i}].label`, 1, 40),
      amount: int(c.amount, `categories[${i}].amount`, 1, MAX_ABS),
    };
  });
  return { version: 1, generatedAt, months, categories };
}
