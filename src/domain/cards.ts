import { CreditCard } from '../types';
import { addMonthsToKey, monthKey, parseISO } from './dates';

/** Invoice open today: the next one due (current month up to the due day, then the following). */
export function openInvoiceKey(card: CreditCard, todayISO: string): string {
  const key = monthKey(todayISO);
  return parseISO(todayISO).d <= card.dueDay ? key : addMonthsToKey(key, 1);
}

/** Colors available to identify a card (no green). */
export const CARD_COLORS: { label: string; value: string }[] = [
  { label: 'Purple', value: '#8B3FD9' },
  { label: 'Blue', value: '#2F80ED' },
  { label: 'Sky', value: '#0EA5E9' },
  { label: 'Coral', value: '#E0446A' },
  { label: 'Orange', value: '#F08A5D' },
  { label: 'Yellow', value: '#F2B544' },
  { label: 'Pink', value: '#E056A0' },
  { label: 'Gray', value: '#64748B' },
];

/** Card color: the chosen one or, if none, one from the palette by list position. */
export function cardColor(card: CreditCard, index: number): string {
  return card.color ?? CARD_COLORS[index % CARD_COLORS.length].value;
}
