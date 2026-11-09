import { getCurrency, getLocale } from '../i18n';

/** Formatters are cached per locale and currency (building one is slow). */
const cache = new Map<string, Intl.NumberFormat>();
function formatter(): Intl.NumberFormat {
  const key = `${getLocale()}|${getCurrency()}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: getCurrency() });
    } catch {
      f = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD' });
    }
    cache.set(key, f);
  }
  return f;
}

/** Decimal places of the current currency: 2 for most, 0 for yen or won, 3 for dinars. Amounts are stored in the smallest unit. */
export function currencyDigits(): number {
  return formatter().resolvedOptions().maximumFractionDigits ?? 2;
}

/** How many stored units make one whole unit of the current currency (100 for dollars, 1 for yen). */
export function minorUnit(): number {
  return 10 ** currencyDigits();
}

/** Formats an amount stored in the smallest unit of the current currency (cents for dollars). */
export function formatMoney(cents: number): string {
  return formatter().format(cents / minorUnit());
}

/** Converts typed digits (e.g. "12345") to cents. */
export function digitsToCents(text: string): number {
  const digits = text.replace(/\D/g, '').slice(0, 12);
  return digits ? Number(digits) : 0;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const shortCache = new Map<string, Intl.NumberFormat>();
/**
 * An amount for a place with little room (a figure card, a legend, a chart): the exact value below 1,000 whole units, a short one
 * above it (1.2K, R$ 1,2 mil, 3,4 Mio. €, 2.1B, according to the language). Anywhere the exact amount matters (a form, a statement, a list
 * row) `formatMoney` stays.
 */
export function formatMoneyShort(cents: number): string {
  const whole = Math.abs(cents) / minorUnit();
  if (whole < 1000) return formatMoney(cents);
  const key = `${getLocale()}|${getCurrency()}`;
  let f = shortCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: getCurrency(), notation: 'compact', maximumFractionDigits: 1 });
    } catch {
      f = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
    }
    shortCache.set(key, f);
  }
  return f.format(cents / minorUnit());
}

const inCache = new Map<string, { digits: number; full: Intl.NumberFormat; short: Intl.NumberFormat }>();
/** An amount in somebody else's currency (the owner of a shared summary): the same short style, in the language on screen. */
export function formatMoneyShortIn(cents: number, currency: string): string {
  const key = `${getLocale()}|${currency}`;
  let f = inCache.get(key);
  if (!f) {
    try {
      const full = new Intl.NumberFormat(getLocale(), { style: 'currency', currency });
      f = { digits: full.resolvedOptions().maximumFractionDigits ?? 2, full, short: new Intl.NumberFormat(getLocale(), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }) };
    } catch {
      return formatMoneyShort(cents);
    }
    inCache.set(key, f);
  }
  const whole = cents / 10 ** f.digits;
  return Math.abs(whole) < 1000 ? f.full.format(whole) : f.short.format(whole);
}
