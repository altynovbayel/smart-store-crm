const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Converts a timestamptz string to epoch microseconds, preserving PostgreSQL precision
 * (JS Date truncates to milliseconds, which could reorder points within the same millisecond).
 * Returns null for unparseable input.
 */
export const toEpochMicros = (value: string): number | null => {
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms * 1000;
  }

  const [, base, fraction = '', rawOffset = 'Z'] = match;
  let offset = rawOffset;
  if (offset !== 'Z') {
    const sign = offset[0];
    const digits = offset.slice(1).replace(':', '');
    offset = `${sign}${digits.slice(0, 2)}:${digits.slice(2, 4).padEnd(2, '0')}`;
  }

  const wholeSecondsMs = Date.parse(`${base.replace(' ', 'T')}${offset}`);
  if (Number.isNaN(wholeSecondsMs)) return null;

  const micros = Number(fraction.padEnd(6, '0').slice(0, 6));
  return wholeSecondsMs * 1000 + micros;
};
