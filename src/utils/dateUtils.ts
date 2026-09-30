/**
 * Date utility functions for smart parsing, formatting, and filtering.
 */

export const parseCustomDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;

  // Handle DD.MM.YYYY or DD.MM.YYYY HH:mm
  const ruMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (ruMatch) {
    const [, d, m, y, h = '00', min = '00'] = ruMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
    return isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Formats a date string to "DD.MM.YYYY HH:mm"
 */
export const formatDateTime = (dateStr: string): string => {
  const d = parseCustomDate(dateStr);
  if (!d) return dateStr || '—';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

/**
 * Checks if a date corresponds to today (or optional reference date).
 */
export const isToday = (dateStr: string, referenceDateStr?: string): boolean => {
  const target = parseCustomDate(dateStr);
  if (!target) return false;

  const now = referenceDateStr ? parseCustomDate(referenceDateStr) ?? new Date() : new Date();
  return (
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  );
};

/**
 * Checks if a date falls within the last N days (including today).
 */
export const isWithinDays = (
  dateStr: string,
  days: number,
  referenceDateStr?: string
): boolean => {
  const target = parseCustomDate(dateStr);
  if (!target) return false;

  const now = referenceDateStr ? parseCustomDate(referenceDateStr) ?? new Date() : new Date();
  // Start of day `days` ago (inclusive)
  const threshold = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days + 1,
    0,
    0,
    0,
    0
  );
  // End of today (inclusive) to exclude future dates
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );

  return (
    target.getTime() >= threshold.getTime() &&
    target.getTime() <= endOfToday.getTime()
  );
};

/**
 * Returns current local time formatted for `<input type="datetime-local">` (YYYY-MM-DDTHH:mm)
 */
export const getCurrentLocalDatetime = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Returns an ISO date-time string relative to today (daysAgo >= 0).
 */
export const getRelativeDateISO = (
  daysAgo: number,
  hours = 10,
  minutes = 0
): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hh}:${mm}`;
};

/**
 * Returns a formatted "DD.MM.YYYY HH:mm" string relative to today.
 */
export const getRelativeDateTimeFormatted = (
  daysAgo: number,
  hours = 10,
  minutes = 0
): string => {
  return formatDateTime(getRelativeDateISO(daysAgo, hours, minutes));
};
