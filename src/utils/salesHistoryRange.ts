import type { SalesHistoryFilters, SalesHistoryServerRange } from '../types';
import { validateDateRange } from './salesHistoryUtils';

export type { SalesHistoryServerRange };

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a local calendar date key "YYYY-MM-DD" into its parts (null when malformed). */
const parseDateKey = (key: string): { year: number; month: number; day: number } | null => {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const probe = new Date(year, month, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month || probe.getDate() !== day) {
    return null;
  }
  return { year, month, day };
};

/**
 * ISO instant of LOCAL midnight of the given calendar day shifted by `dayOffset` days.
 * Built from calendar components (not by adding 24h), so DST transitions keep exact midnights.
 */
export const localDayStartIso = (dateKey: string, dayOffset = 0): string | null => {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;
  return new Date(parts.year, parts.month, parts.day + dayOffset, 0, 0, 0, 0).toISOString();
};

/**
 * Maps history filters to the server range. Windows match filterSalesHistory exactly
 * (isToday / isWithinDays(7|30) / custom calendar days); the client filter still runs on the
 * loaded receipts, so a superset from the server never changes the UI semantics.
 */
export const getSalesHistoryServerRange = (
  filters: Pick<SalesHistoryFilters, 'period' | 'dateFrom' | 'dateTo'>,
  currentDateKey: string
): SalesHistoryServerRange => {
  const tomorrowStart = localDayStartIso(currentDateKey, 1);

  switch (filters.period) {
    case 'all':
      return { kind: 'all', key: 'all' };

    case 'today':
    case 'week':
    case 'month': {
      const days = filters.period === 'today' ? 1 : filters.period === 'week' ? 7 : 30;
      const soldFrom = localDayStartIso(currentDateKey, -(days - 1));
      if (!soldFrom || !tomorrowStart) return { kind: 'invalid', key: `invalid:${filters.period}` };
      return {
        kind: 'range',
        key: `range:${soldFrom}:${tomorrowStart}`,
        soldFrom,
        soldBefore: tomorrowStart,
      };
    }

    case 'custom': {
      const { dateFrom, dateTo } = filters;
      const errors = validateDateRange(dateFrom, dateTo, currentDateKey);
      if (errors.from || errors.to) {
        return { kind: 'invalid', key: `invalid:${dateFrom}:${dateTo}` };
      }
      if (!dateFrom && !dateTo) {
        // An empty custom range does not restrict dates (same as filterSalesHistory)
        return { kind: 'all', key: 'all' };
      }

      const soldFrom = dateFrom ? localDayStartIso(dateFrom) : undefined;
      const soldBefore = dateTo ? localDayStartIso(dateTo, 1) : undefined;
      if (soldFrom === null || soldBefore === null) {
        return { kind: 'invalid', key: `invalid:${dateFrom}:${dateTo}` };
      }
      return {
        kind: 'range',
        key: `range:${soldFrom ?? ''}:${soldBefore ?? ''}`,
        soldFrom,
        soldBefore,
      };
    }
  }
};
