// Hand written validators: a faithful port of firebase/firestore.rules (the spec).
// Each validator throws ValidationError with a clear message; `validate` turns it into a result.

export type Doc = Record<string, unknown>;
export const COLLECTIONS = ['transactions', 'cards', 'payments', 'reserves', 'reserveMoves', 'categories', 'shoppingLists', 'wishlist'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export class ValidationError extends Error {}
const fail = (message: string): never => {
  throw new ValidationError(message);
};

const MAX_CENTS = 100_000_000_000;
export const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

const isObject = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (d: Doc, k: string) => Object.prototype.hasOwnProperty.call(d, k);
const strLen = (s: string) => [...s].length;

function onlyKeys(d: Doc, allowed: string[], required: string[]) {
  for (const k of Object.keys(d)) if (!allowed.includes(k)) fail(`unknown field "${k}"`);
  for (const k of required) if (!has(d, k)) fail(`missing field "${k}"`);
}

function text(d: Doc, k: string, max: number) {
  const v = d[k];
  if (typeof v !== 'string' || v.length === 0 || strLen(v) > max) fail(`"${k}" must be a string of 1 to ${max} characters`);
  if ((v as string).includes('\u0000')) fail(`"${k}" contains an invalid character`);
}
const optText = (d: Doc, k: string, max: number) => has(d, k) && text(d, k, max);

function cents(d: Doc, k: string) {
  const v = d[k];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > MAX_CENTS) {
    fail(`"${k}" must be a positive integer (cents) up to ${MAX_CENTS}`);
  }
}

function isoDate(d: Doc, k: string) {
  const v = d[k];
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) fail(`"${k}" must be a date as YYYY-MM-DD`);
  const [y, m, day] = (v as string).split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, day));
  // PostgreSQL stores a real calendar date, so impossible dates (2026-02-31) are rejected too
  if (y < 1 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) {
    fail(`"${k}" is not a valid calendar date`);
  }
}

const monthKey = (d: Doc, k: string) => {
  if (typeof d[k] !== 'string' || !/^[0-9]{4}-[0-9]{2}$/.test(d[k] as string)) fail(`"${k}" must be a month as YYYY-MM`);
};

function bool(d: Doc, k: string) {
  if (typeof d[k] !== 'boolean') fail(`"${k}" must be a boolean`);
}

function intRange(v: unknown, name: string, min: number, max: number) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail(`${name} must be an integer from ${min} to ${max}`);
}

// createdAt / archivedAt: ms since the epoch. The rules accept any number; they are stored as
// bigint, so only integers are accepted here.
function msTimestamp(d: Doc, k: string) {
  if (has(d, k) && (typeof d[k] !== 'number' || !Number.isSafeInteger(d[k]))) fail(`"${k}" must be an integer number (ms)`);
}

/** Who made the record: only 'claude' (an assistant through MCP); absent when the person did. */
function sourceOk(d: Doc) {
  if (has(d, 'source') && d.source !== 'claude') fail('"source" must be "claude" when present');
}

function noNul(v: unknown, k: string) {
  // jsonb cannot store \u0000
  if (JSON.stringify(v).includes('\\u0000')) fail(`"${k}" contains an invalid character`);
}

function checkId(d: Doc) {
  if (typeof d.id !== 'string' || !ID_RE.test(d.id)) fail('"id" must match ^[A-Za-z0-9_.-]{1,100}$');
}

function installment(d: Doc) {
  const i = d.installment;
  if (!isObject(i)) return fail('"installment" must be an object');
  onlyKeys(i, ['index', 'total', 'groupId'], ['index', 'total', 'groupId']);
  intRange(i.index, 'installment.index', 1, 120);
  intRange(i.total, 'installment.total', 1, 120);
  text(i, 'groupId', 40);
}

function transaction(d: Doc) {
  onlyKeys(
    d,
    ['id', 'type', 'description', 'amount', 'date', 'confirmed', 'fixed', 'confirmedMonths', 'cardId', 'reserveId',
      'invoiceKey', 'category', 'installment', 'createdAt', 'revisions', 'overrides', 'archivedAt', 'source'],
    ['id', 'type', 'description', 'amount', 'date', 'confirmed', 'fixed', 'confirmedMonths'],
  );
  checkId(d);
  sourceOk(d);
  if (d.type !== 'income' && d.type !== 'expense') fail('"type" must be income or expense');
  text(d, 'description', 100);
  cents(d, 'amount');
  isoDate(d, 'date');
  bool(d, 'confirmed');
  bool(d, 'fixed');
  const cm = d.confirmedMonths;
  if (!Array.isArray(cm) || cm.length > 600) fail('"confirmedMonths" must be a list of at most 600 items');
  // the rules do not look inside the list; it is stored as text[], so items must be short strings
  for (const m of cm as unknown[]) {
    if (typeof m !== 'string' || m.length === 0 || m.length > 20 || m.includes('\u0000')) fail('"confirmedMonths" items must be short strings');
  }
  optText(d, 'cardId', 40);
  optText(d, 'reserveId', 40);
  if (has(d, 'cardId') && has(d, 'reserveId')) fail('a transaction cannot have both cardId and reserveId');
  if (has(d, 'reserveId') && d.type !== 'expense') fail('only an expense can be paid from a reserve');
  if (has(d, 'invoiceKey')) monthKey(d, 'invoiceKey');
  optText(d, 'category', 40);
  if (has(d, 'installment')) installment(d);
  msTimestamp(d, 'createdAt');
  // per-month edits of a fixed transaction: only type and size are validated (as in the rules)
  if (has(d, 'revisions')) {
    if (d.fixed !== true) fail('"revisions" is only allowed on a fixed transaction');
    if (!Array.isArray(d.revisions) || d.revisions.length > 60) fail('"revisions" must be a list of at most 60 items');
    noNul(d.revisions, 'revisions');
  }
  if (has(d, 'overrides')) {
    if (d.fixed !== true) fail('"overrides" is only allowed on a fixed transaction');
    if (!isObject(d.overrides) || Object.keys(d.overrides).length > 600) fail('"overrides" must be a map of at most 600 entries');
    noNul(d.overrides, 'overrides');
  }
  msTimestamp(d, 'archivedAt');
}

function card(d: Doc) {
  onlyKeys(d, ['id', 'name', 'limit', 'dueDay', 'color', 'createdAt', 'archivedAt', 'source'], ['id', 'name', 'limit', 'dueDay']);
  checkId(d);
  sourceOk(d);
  text(d, 'name', 60);
  cents(d, 'limit');
  intRange(d.dueDay, '"dueDay"', 1, 31);
  if (has(d, 'color') && !(typeof d.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(d.color))) fail('"color" must be #RRGGBB');
  msTimestamp(d, 'createdAt');
  msTimestamp(d, 'archivedAt');
}

function reserve(d: Doc) {
  onlyKeys(d, ['id', 'name', 'goal', 'createdAt', 'archivedAt'], ['id', 'name']);
  checkId(d);
  text(d, 'name', 60);
  if (has(d, 'goal')) cents(d, 'goal');
  msTimestamp(d, 'createdAt');
  msTimestamp(d, 'archivedAt');
}

function reserveMove(d: Doc) {
  onlyKeys(d, ['id', 'reserveId', 'type', 'amount', 'date', 'confirmed', 'createdAt', 'archivedAt'], ['id', 'reserveId', 'type', 'amount', 'date']);
  checkId(d);
  text(d, 'reserveId', 40);
  if (d.type !== 'deposit' && d.type !== 'withdraw') fail('"type" must be deposit or withdraw');
  cents(d, 'amount');
  isoDate(d, 'date');
  if (has(d, 'confirmed')) bool(d, 'confirmed');
  msTimestamp(d, 'createdAt');
  msTimestamp(d, 'archivedAt');
}

function payment(d: Doc) {
  onlyKeys(d, ['id', 'cardId', 'invoiceKey', 'amount', 'date', 'archivedAt', 'source'], ['id', 'cardId', 'invoiceKey', 'amount', 'date']);
  checkId(d);
  sourceOk(d);
  text(d, 'cardId', 40);
  monthKey(d, 'invoiceKey');
  cents(d, 'amount');
  isoDate(d, 'date');
  msTimestamp(d, 'archivedAt');
}

/** How an expense category counts for financial health. */
export const TONES: string[] = ['healthy', 'necessary', 'comfort', 'luxury', 'unhealthy', 'unknown'];

function category(d: Doc) {
  onlyKeys(d, ['id', 'slug', 'kind', 'name', 'weight', 'tone', 'createdAt', 'archivedAt', 'source'], ['id', 'slug', 'kind', 'name']);
  checkId(d);
  sourceOk(d);
  text(d, 'slug', 60);
  if (d.kind !== 'expense' && d.kind !== 'income') fail('"kind" must be expense or income');
  text(d, 'name', 40);
  if (has(d, 'weight')) {
    const w = d.weight;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1) fail('"weight" must be a number from 0 to 1');
    if (d.kind !== 'expense') fail('"weight" is only allowed on an expense category');
  }
  if (has(d, 'tone')) {
    if (typeof d.tone !== 'string' || !TONES.includes(d.tone)) fail('"tone" must be one of ' + TONES.join(', '));
    if (d.kind !== 'expense') fail('"tone" is only allowed on an expense category');
  }
  msTimestamp(d, 'createdAt');
  msTimestamp(d, 'archivedAt');
}

function shoppingList(d: Doc) {
  onlyKeys(d, ['id', 'name', 'items', 'finishedAt', 'createdAt', 'archivedAt'], ['id', 'name', 'items']);
  checkId(d);
  text(d, 'name', 60);
  if (!Array.isArray(d.items) || d.items.length > 300) fail('"items" must be a list of at most 300 items');
  const seen = new Set<string>();
  for (const [i, raw] of (d.items as unknown[]).entries()) {
    if (!isObject(raw)) return fail(`items[${i}] must be an object`);
    onlyKeys(raw, ['id', 'name', 'done', 'archivedAt'], ['id', 'name', 'done']);
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) fail(`items[${i}].id is not a valid id`);
    if (seen.has(raw.id as string)) fail(`items[${i}].id is repeated`);
    seen.add(raw.id as string);
    if (typeof raw.name !== 'string' || raw.name.length === 0 || strLen(raw.name) > 80) fail(`items[${i}].name must be a string of 1 to 80 characters`);
    if ((raw.name as string).includes('\u0000')) fail(`items[${i}].name contains an invalid character`);
    if (typeof raw.done !== 'boolean') fail(`items[${i}].done must be a boolean`);
    if (has(raw, 'archivedAt') && (typeof raw.archivedAt !== 'number' || !Number.isSafeInteger(raw.archivedAt))) fail(`items[${i}].archivedAt must be an integer number (ms)`);
  }
  msTimestamp(d, 'finishedAt');
  msTimestamp(d, 'createdAt');
  msTimestamp(d, 'archivedAt');
}

function wish(d: Doc) {
  onlyKeys(d, ['id', 'name', 'price', 'url', 'note', 'boughtAt', 'createdAt', 'archivedAt'], ['id', 'name']);
  checkId(d);
  text(d, 'name', 80);
  if (has(d, 'price')) cents(d, 'price');
  if (has(d, 'url')) {
    text(d, 'url', 500);
    if (!/^https?:\/\/\S+$/i.test(d.url as string)) fail('"url" must be a link starting with http:// or https://');
  }
  optText(d, 'note', 300);
  msTimestamp(d, 'boughtAt');
  msTimestamp(d, 'createdAt');
  msTimestamp(d, 'archivedAt');
}

const validators: Record<Collection, (d: Doc) => void> = {
  transactions: transaction,
  cards: card,
  payments: payment,
  reserves: reserve,
  reserveMoves: reserveMove,
  categories: category,
  shoppingLists: shoppingList,
  wishlist: wish,
};

/** Returns null when valid, otherwise the first error message. */
export function validate(collection: Collection, doc: unknown): string | null {
  if (!isObject(doc)) return 'document must be an object';
  try {
    validators[collection](doc);
    return null;
  } catch (e) {
    if (e instanceof ValidationError) return e.message;
    throw e;
  }
}
