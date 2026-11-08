// Validators for the social routes, in the style of validate.ts: hand written, strict, no unknown fields.
import { ValidationError, type Doc } from './validate.js';

const fail = (message: string): never => {
  throw new ValidationError(message);
};

const MAX_ABS = 100_000_000_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** a public profile id, in its lowercase canonical form */
export const isPublicId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
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

/** A public profile id (a uuid), as sent in a body: any letter case is accepted and normalized to lower case. */
export function parseId(v: unknown, name = 'id'): string {
  const id = typeof v === 'string' ? v.toLowerCase() : v;
  if (!isPublicId(id)) return fail(`"${name}" must be a uuid`);
  return id;
}

/** `{ id }` and nothing else. */
export function parseIdBody(input: unknown, key = 'id'): string {
  const d = obj(input, 'the body');
  onlyKeys(d, [key], [key]);
  return parseId(d[key], key);
}

export interface ProfileInput {
  displayName: string;
  color: string | null;
}

export function parseProfile(input: unknown): ProfileInput {
  const d = obj(input, 'the body');
  onlyKeys(d, ['displayName', 'color'], ['displayName']);
  const displayName = str(d.displayName, 'displayName', 1, 40);
  if (displayName.trim().length === 0) fail('"displayName" cannot be blank');
  let color: string | null = null;
  if (has(d, 'color') && d.color !== null) {
    if (typeof d.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(d.color)) fail('"color" must be a color as #RRGGBB');
    color = d.color as string;
  }
  return { displayName: displayName.trim(), color };
}

export function parseMessage(input: unknown): { to: string; body: string } {
  const d = obj(input, 'the body');
  onlyKeys(d, ['to', 'body'], ['to', 'body']);
  const to = parseId(d.to, 'to');
  if (typeof d.body !== 'string') fail('"body" must be a string');
  const body = (d.body as string).trim();
  str(body, 'body', 1, 1000);
  return { to, body };
}

/** Percentages of income only: the shared summary never carries a money amount. */
export interface SummaryCategory {
  slug: string;
  label: string;
  pct: number;
}
export interface Summary {
  version: 2;
  generatedAt: number;
  spent: number;
  saved: number;
  months: { key: string; spent: number; saved: number; categories: SummaryCategory[] }[];
  categories: SummaryCategory[];
}

function pct(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return fail(`"${name}" must be a number from ${min} to ${max}`);
  return v;
}

function categories(raw: unknown, name: string): SummaryCategory[] {
  if (!Array.isArray(raw) || raw.length > 40) return fail(`"${name}" must be a list of at most 40 items`);
  return raw.map((r, i) => {
    const c = obj(r, `${name}[${i}]`);
    onlyKeys(c, ['slug', 'label', 'pct'], ['slug', 'label', 'pct']);
    return {
      slug: str(c.slug, `${name}[${i}].slug`, 1, 40),
      label: str(c.label, `${name}[${i}].label`, 1, 40),
      pct: pct(c.pct, `${name}[${i}].pct`, 0, 1000),
    };
  });
}

export function parseSummary(input: unknown): Summary {
  const d = obj(input, 'the body');
  onlyKeys(d, ['version', 'generatedAt', 'spent', 'saved', 'months', 'categories'], ['version', 'generatedAt', 'spent', 'saved', 'months', 'categories']);
  if (d.version !== 2) fail('"version" must be 2');
  const generatedAt = int(d.generatedAt, 'generatedAt', 0, 100_000_000_000_000);
  const spent = pct(d.spent, 'spent', 0, 1000);
  const saved = pct(d.saved, 'saved', -1000, 100);
  if (!Array.isArray(d.months) || d.months.length > 24) fail('"months" must be a list of at most 24 items');
  const seen = new Set<string>();
  const months = (d.months as unknown[]).map((raw, i) => {
    const m = obj(raw, `months[${i}]`);
    onlyKeys(m, ['key', 'spent', 'saved', 'categories'], ['key', 'spent', 'saved', 'categories']);
    if (typeof m.key !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(m.key)) fail(`months[${i}].key must be a month as YYYY-MM`);
    if (seen.has(m.key as string)) fail(`months[${i}].key is repeated`);
    seen.add(m.key as string);
    return {
      key: m.key as string,
      spent: pct(m.spent, `months[${i}].spent`, 0, 1000),
      saved: pct(m.saved, `months[${i}].saved`, -1000, 100),
      categories: categories(m.categories, `months[${i}].categories`),
    };
  });
  return { version: 2, generatedAt, spent, saved, months, categories: categories(d.categories, 'categories') };
}
