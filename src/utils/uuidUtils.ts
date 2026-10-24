const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict runtime check for the canonical 8-4-4-4-12 hex UUID format accepted by PostgreSQL `uuid`.
 */
export const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * Generates a v4 UUID using the platform CSPRNG.
 * Falls back to crypto.getRandomValues (available in non-secure contexts where randomUUID is not).
 * Returns null when no cryptographic source is available — callers must block the operation.
 */
export const generateUuid = (): string | null => {
  if (typeof crypto === 'undefined') return null;

  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto.getRandomValues !== 'function') return null;

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return isValidUuid(uuid) ? uuid : null;
};
