const brl = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' });

export function formatMoney(cents: number): string {
  return brl.format(cents / 100);
}

/** Converts typed digits (e.g. "12345") to cents. */
export function digitsToCents(text: string): number {
  const digits = text.replace(/\D/g, '').slice(0, 12);
  return digits ? Number(digits) : 0;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
