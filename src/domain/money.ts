/** The platform's default currency is the US dollar, always shown with `$`. */
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(cents: number): string {
  return usd.format(cents / 100);
}

/** Converts typed digits (e.g. "12345") to cents. */
export function digitsToCents(text: string): number {
  const digits = text.replace(/\D/g, '').slice(0, 12);
  return digits ? Number(digits) : 0;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
