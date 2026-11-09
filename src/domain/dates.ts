import { getLocale } from '../i18n';

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function todayISO(): string {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonthKey(): string {
  return monthKey(todayISO());
}

export function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Adds months keeping the day, clamped to the last day of the month when needed. */
export function addMonths(iso: string, n: number): string {
  const { d } = parseISO(iso);
  const [y, m] = addMonthsToKey(monthKey(iso), n).split('-').map(Number);
  return toISO(y, m, Math.min(d, daysInMonth(y, m)));
}

export function endOfMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return toISO(y, m, daysInMonth(y, m));
}

const monthNames = new Map<string, string[]>();
/** The twelve month names in the current language (from Intl, so every language is covered). */
function monthNamesNow(): string[] {
  const loc = getLocale();
  let names = monthNames.get(loc);
  if (!names) {
    const f = new Intl.DateTimeFormat(loc, { month: 'long', timeZone: 'UTC' });
    names = Array.from({ length: 12 }, (_, i) => {
      const n = f.format(new Date(Date.UTC(2021, i, 15)));
      return n.charAt(0).toLocaleUpperCase(loc) + n.slice(1);
    });
    monthNames.set(loc, names);
  }
  return names;
}

export function monthName(m: number): string {
  return monthNamesNow()[m - 1];
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${monthNamesNow()[m - 1]} ${y}`;
}

/** "2026-03" -> "03/2026". Never abbreviated: used on chart axes and tooltips. */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${pad(m)}/${y}`;
}

type DateOrder = { order: ('d' | 'm' | 'y')[]; sep: string };
const orders = new Map<string, DateOrder>();
/** The order and separator of a numeric date in the current language (31/12/2026, 12/31/2026, 31.12.2026...). */
export function dateOrder(): DateOrder {
  const loc = getLocale();
  let o = orders.get(loc);
  if (!o) {
    const parts = new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(2021, 10, 25)));
    const order = parts.flatMap((p) => (p.type === 'day' ? ['d' as const] : p.type === 'month' ? ['m' as const] : p.type === 'year' ? ['y' as const] : []));
    const sep = parts.find((p) => p.type === 'literal')?.value.trim() || '/';
    o = { order, sep };
    orders.set(loc, o);
  }
  return o;
}

export function formatDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  const { order, sep } = dateOrder();
  return order.map((k) => (k === 'd' ? pad(d) : k === 'm' ? pad(m) : String(y))).join(sep);
}

/** Short weekday initials, Sunday first, in the current language. */
export function weekdayInitials(): string[] {
  const f = new Intl.DateTimeFormat(getLocale(), { weekday: 'narrow', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2021, 10, 7 + i))));
}

/** Accepts a typed date in the order of the current language (or digits only) and returns ISO, or null if invalid. */
export function parseLocalDate(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const { order } = dateOrder();
  const at = (k: 'd' | 'm' | 'y') => {
    let pos = 0;
    for (const o of order) {
      const len = o === 'y' ? 4 : 2;
      if (o === k) return Number(digits.slice(pos, pos + len));
      pos += len;
    }
    return 0;
  };
  const d = at('d');
  const m = at('m');
  const y = at('y');
  if (m < 1 || m > 12 || y < 1900 || d < 1 || d > daysInMonth(y, m)) return null;
  return toISO(y, m, d);
}

/** Masks typed digits in the date order of the current language. */
export function maskLocalDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  const { order, sep } = dateOrder();
  const out: string[] = [];
  let pos = 0;
  for (const o of order) {
    const len = o === 'y' ? 4 : 2;
    if (pos >= digits.length) break;
    out.push(digits.slice(pos, pos + len));
    pos += len;
  }
  return out.join(sep);
}

/** Month and day of a timestamp ("Nov 9"), in the current language. */
export function shortDate(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}) });
}

/** The time of a timestamp ("3:05 PM"), in the current language. */
export function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' });
}
