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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2026-03" -> "03/2026". Never abbreviated: used on chart axes and tooltips. */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${pad(m)}/${y}`;
}

export function formatDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** Accepts "DD/MM/YYYY" (or digits only) and returns ISO, or null if invalid. */
export function parseBRDate(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const d = Number(digits.slice(0, 2));
  const m = Number(digits.slice(2, 4));
  const y = Number(digits.slice(4));
  if (m < 1 || m > 12 || y < 1900 || d < 1 || d > daysInMonth(y, m)) return null;
  return toISO(y, m, d);
}

export function maskBRDate(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
