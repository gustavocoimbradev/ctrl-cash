import { useMemo } from 'react';
import { currentMonthKey, endOfMonth } from '../domain/dates';
import { buildOccurrences, currentBalance } from '../domain/transactions';
import { useStore } from '.';

/**
 * Real current wallet balance: everything confirmed up to the end of the current month.
 * Independent of the month shown on screen (stays fixed in the top bar).
 */
export function useCurrentBalance(): number {
  const { data } = useStore();
  return useMemo(() => {
    const month = currentMonthKey();
    const occ = buildOccurrences(data, month);
    return currentBalance(occ, data.payments, endOfMonth(month));
  }, [data]);
}
