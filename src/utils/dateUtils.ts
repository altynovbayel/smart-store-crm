/**
 * Date utility functions for smart parsing, formatting, and filtering.
 */

export const parseCustomDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;

  // Handle DD.MM.YYYY or DD.MM.YYYY HH:mm or DD.MM.YYYY HH:mm:ss or DD.MM.YYYY HH:mm:ss.SSS
  const ruMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (ruMatch) {
    const [, d, m, y, h = '00', min = '00', s = '00', ms = '0'] = ruMatch;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    const hours = Number(h);
    const minutes = Number(min);
    const seconds = Number(s);
    const milliseconds = Number(ms.padEnd(3, '0').slice(0, 3));
    const date = new Date(year, month, day, hours, minutes, seconds, milliseconds);
    if (
      isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day ||
      date.getHours() !== hours ||
      date.getMinutes() !== minutes ||
      date.getSeconds() !== seconds ||
      date.getMilliseconds() !== milliseconds
    ) {
      return null;
    }
    return date;
  }

  // Handle YYYY-MM-DD or YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm or YYYY-MM-DDTHH:mm:ss(.SSS) (as local dates)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (isoMatch) {
    const [, y, m, d, h = '00', min = '00', s = '00', ms = '0'] = isoMatch;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    const hours = Number(h);
    const minutes = Number(min);
    const seconds = Number(s);
    const milliseconds = Number(ms.padEnd(3, '0').slice(0, 3));
    const date = new Date(year, month, day, hours, minutes, seconds, milliseconds);
    if (
      isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day ||
      date.getHours() !== hours ||
      date.getMinutes() !== minutes ||
      date.getSeconds() !== seconds ||
      date.getMilliseconds() !== milliseconds
    ) {
      return null;
    }
    return date;
  }

  const isoUtcMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/);
  if (isoUtcMatch) {
    const [, y, m, d, h, min, s, ms = '0'] = isoUtcMatch;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    const hours = Number(h);
    const minutes = Number(min);
    const seconds = Number(s);
    const milliseconds = Number(ms.padEnd(3, '0').slice(0, 3));
    const date = new Date(Date.UTC(year, month, day, hours, minutes, seconds, milliseconds));
    if (
      isNaN(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hours ||
      date.getUTCMinutes() !== minutes ||
      date.getUTCSeconds() !== seconds ||
      date.getUTCMilliseconds() !== milliseconds
    ) {
      return null;
    }
    return date;
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
 * Returns current local time formatted for `<input type="datetime-local">` (YYYY-MM-DDTHH:mm:ss)
 */
export const getCurrentLocalDatetime = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
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

/**
 * Returns an ISO date-time string guaranteed to be in the past (by minutesAgo minutes).
 */
export const getGuaranteedPastDateISO = (minutesAgo: number): string => {
  const d = new Date(Date.now() - Math.max(1, minutesAgo) * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hh}:${mm}`;
};

/**
 * Returns a formatted "DD.MM.YYYY HH:mm" string guaranteed to be in the past.
 */
export const getGuaranteedPastDateTimeFormatted = (minutesAgo: number): string => {
  return formatDateTime(getGuaranteedPastDateISO(minutesAgo));
};

/**
 * Returns a strictly padded "YYYY-MM-DD" calendar date key for stable date matching.
 */
export const formatCalendarDateKey = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Checks whether a date string explicitly includes seconds or fractional seconds.
 */
export const hasExplicitSeconds = (dateStr: string): boolean => {
  const trimmed = dateStr.trim();
  // Match :SS in time portion (e.g., "12:34:56" or "T12:34:56" or "12:34:56.789Z")
  return /(?:[T\s]\d{2}:\d{2}:\d{2}|^\d{2}:\d{2}:\d{2})/.test(trimmed);
};

/**
 * Resolves the precise timestamp (in milliseconds) for a document date string.
 * Returns the exact parsed timestamp for ISO strings, dates with seconds/milliseconds,
 * and minute-level dates deterministically.
 */
export const getDocumentTimestamp = (dateStr?: string): number => {
  if (!dateStr) return 0;
  const parsed = parseCustomDate(dateStr);
  return parsed && !isNaN(parsed.getTime()) ? parsed.getTime() : 0;
};

/**
 * Normalizes a document date string into an exact epoch millisecond timestamp.
 * If dateStr is omitted or invalid, returns fallbackNow (default Date.now()).
 * When dateStr is provided, deterministically returns the parsed timestamp.
 */
export const normalizeDocumentTimestamp = (
  dateStr?: string,
  fallbackNow: number = Date.now()
): number => {
  if (!dateStr) return fallbackNow;
  const parsed = parseCustomDate(dateStr);
  if (!parsed || isNaN(parsed.getTime())) return fallbackNow;
  return parsed.getTime();
};
