// Validators for the social routes, in the style of validate.ts: hand written, strict, no unknown fields.
import { normalizeCode } from './code.js';
import { TONES, ValidationError, type Doc } from './validate.js';

const fail = (message: string): never => {
  throw new ValidationError(message);
};

const MAX_ABS = 100_000_000_000;
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

/** A profile code as sent in a body: any letter case is accepted and normalized to upper case. */
export function parseCode(v: unknown, name = 'code'): string {
  const code = normalizeCode(v);
  return code ?? fail(`"${name}" must be a 6 character code`);
}

/** `{ code }` and nothing else. */
export function parseCodeBody(input: unknown, key = 'code'): string {
  const d = obj(input, 'the body');
  onlyKeys(d, [key], [key]);
  return parseCode(d[key], key);
}

export const PHOTO_MAX = 60000;
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;

export interface ProfileInput {
  displayName: string;
  color: string | null;
  /** `undefined`: the key was absent (keep the stored photo); `null`: clear it; a string: set it */
  photo: string | null | undefined;
}

export function parseProfile(input: unknown): ProfileInput {
  const d = obj(input, 'the body');
  onlyKeys(d, ['displayName', 'color', 'photo'], ['displayName']);
  const displayName = str(d.displayName, 'displayName', 1, 40);
  if (displayName.trim().length === 0) fail('"displayName" cannot be blank');
  let color: string | null = null;
  if (has(d, 'color') && d.color !== null) {
    if (typeof d.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(d.color)) fail('"color" must be a color as #RRGGBB');
    color = d.color as string;
  }
  let photo: string | null | undefined;
  if (has(d, 'photo') && d.photo !== undefined) {
    if (d.photo === null) photo = null;
    else if (typeof d.photo !== 'string' || (d.photo as string).length > PHOTO_MAX) fail(`"photo" must be a JPEG data URL of at most ${PHOTO_MAX} characters`);
    else if (!PHOTO_RE.test(d.photo as string)) fail('"photo" must be a data:image/jpeg;base64 URL');
    else photo = d.photo as string;
  }
  return { displayName: displayName.trim(), color, photo };
}

export function parseMessage(input: unknown): { to: string; body: string } {
  const d = obj(input, 'the body');
  onlyKeys(d, ['to', 'body'], ['to', 'body']);
  const to = parseCode(d.to, 'to');
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
  /** how the owner classed this category (healthy, necessary...); optional, older snapshots have none */
  tone?: string;
}
export interface Summary {
  version: 2;
  generatedAt: number;
  spent: number;
  saved: number;
  /** `incomeRel`: the month's income as a % of the person's average monthly income (100 = an average month); optional */
  months: { key: string; spent: number; saved: number; incomeRel?: number; categories: SummaryCategory[] }[];
  categories: SummaryCategory[];
  /** the financial health score and how full each part is, in percent; optional */
  health?: { score: number; label: string; wealth: number; debt: number; habits: number; month: number };
  /** wealth projection as the percent change from today's; 24 months at most; never an amount */
  wealth?: { start: string; planned: number[]; habit: number[] };
}

function pct(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return fail(`"${name}" must be a number from ${min} to ${max}`);
  return v;
}

function categories(raw: unknown, name: string): SummaryCategory[] {
  if (!Array.isArray(raw) || raw.length > 40) return fail(`"${name}" must be a list of at most 40 items`);
  return raw.map((r, i) => {
    const c = obj(r, `${name}[${i}]`);
    onlyKeys(c, ['slug', 'label', 'pct', 'tone'], ['slug', 'label', 'pct']);
    if (has(c, 'tone') && (typeof c.tone !== 'string' || !TONES.includes(c.tone))) fail(`"${name}[${i}].tone" must be one of ${TONES.join(', ')}`);
    return {
      slug: str(c.slug, `${name}[${i}].slug`, 1, 40),
      label: str(c.label, `${name}[${i}].label`, 1, 40),
      pct: pct(c.pct, `${name}[${i}].pct`, 0, 1000),
      ...(has(c, 'tone') ? { tone: c.tone as string } : {}),
    };
  });
}

export function parseSummary(input: unknown): Summary {
  const d = obj(input, 'the body');
  onlyKeys(d, ['version', 'generatedAt', 'spent', 'saved', 'months', 'categories', 'health', 'wealth'], ['version', 'generatedAt', 'spent', 'saved', 'months', 'categories']);
  if (d.version !== 2) fail('"version" must be 2');
  const generatedAt = int(d.generatedAt, 'generatedAt', 0, 100_000_000_000_000);
  const spent = pct(d.spent, 'spent', 0, 1000);
  const saved = pct(d.saved, 'saved', -1000, 100);
  if (!Array.isArray(d.months) || d.months.length > 24) fail('"months" must be a list of at most 24 items');
  const seen = new Set<string>();
  const months = (d.months as unknown[]).map((raw, i) => {
    const m = obj(raw, `months[${i}]`);
    onlyKeys(m, ['key', 'spent', 'saved', 'incomeRel', 'categories'], ['key', 'spent', 'saved', 'categories']);
    if (typeof m.key !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(m.key)) fail(`months[${i}].key must be a month as YYYY-MM`);
    if (seen.has(m.key as string)) fail(`months[${i}].key is repeated`);
    seen.add(m.key as string);
    return {
      key: m.key as string,
      spent: pct(m.spent, `months[${i}].spent`, 0, 1000),
      saved: pct(m.saved, `months[${i}].saved`, -1000, 100),
      ...(m.incomeRel === undefined ? {} : { incomeRel: pct(m.incomeRel, `months[${i}].incomeRel`, 0, 10000) }),
      categories: categories(m.categories, `months[${i}].categories`),
    };
  });
  const out: Summary = { version: 2, generatedAt, spent, saved, months, categories: categories(d.categories, 'categories') };
  if (d.health !== undefined) {
    const h = obj(d.health, 'health');
    onlyKeys(h, ['score', 'label', 'wealth', 'debt', 'habits', 'month'], ['score', 'label', 'wealth', 'debt', 'habits', 'month']);
    if (typeof h.label !== 'string' || !['Critical', 'Warning', 'Good', 'Excellent'].includes(h.label)) fail('"health.label" must be Critical, Warning, Good or Excellent');
    out.health = {
      score: int(h.score, 'health.score', 0, 1000),
      label: h.label as string,
      wealth: pct(h.wealth, 'health.wealth', 0, 100),
      debt: pct(h.debt, 'health.debt', 0, 100),
      habits: pct(h.habits, 'health.habits', 0, 100),
      month: pct(h.month, 'health.month', 0, 100),
    };
  }
  if (d.wealth !== undefined) {
    const w = obj(d.wealth, 'wealth');
    onlyKeys(w, ['start', 'planned', 'habit'], ['start', 'planned', 'habit']);
    if (typeof w.start !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(w.start)) fail('"wealth.start" must be a month as YYYY-MM');
    const series = (v: unknown, name: string) => {
      if (!Array.isArray(v) || v.length < 1 || v.length > 24) return fail(`"${name}" must be a list of 1 to 24 numbers`);
      return v.map((n, i) => pct(n, `${name}[${i}]`, -1000, 1000));
    };
    out.wealth = { start: w.start as string, planned: series(w.planned, 'wealth.planned'), habit: series(w.habit, 'wealth.habit') };
  }
  return out;
}
