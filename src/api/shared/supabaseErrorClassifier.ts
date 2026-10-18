import type { ApiErrorKind } from '../../types';

/**
 * Structural classification of Supabase / PostgREST / fetch errors shared by document modules.
 * Classification relies only on `name`, `code` and `status` — never on free text, because
 * PostgreSQL messages may contain product names and other user data.
 */
export interface ErrorSignals {
  name: string;
  code: string;
  status: number | undefined;
}

/** Gateway / edge responses: the request may or may not have reached PostgreSQL. */
export const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

/** Transport-level error names and Node/undici-style codes. */
const TRANSPORT_ERROR_NAMES: ReadonlySet<string> = new Set(['AbortError', 'TimeoutError']);
const TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ABORT_ERR',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** PostgREST / PostgreSQL authentication and authorization codes. */
const AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  'PGRST301', // JWT invalid / cannot be decoded
  'PGRST302', // anonymous access disabled
  'PGRST303', // JWT expired / claims validation failed
  '28000', // invalid_authorization_specification (not authenticated)
  '28P01', // invalid_password
  '42501', // insufficient_privilege (inactive profile / not admin)
]);

/** Codes meaning the session itself is missing or expired (as opposed to insufficient privileges). */
const SESSION_ERROR_CODES: ReadonlySet<string> = new Set(['PGRST301', 'PGRST302', 'PGRST303', '28000']);

/**
 * SQLSTATE classes where the transaction outcome cannot be treated as a deterministic refusal:
 * 08 connection exception, 40 transaction rollback, 53 insufficient resources,
 * 57 operator intervention (incl. statement timeout), 58 system error, XX internal error.
 */
const INDETERMINATE_SQLSTATE_CLASSES: ReadonlySet<string> = new Set(['08', '40', '53', '57', '58', 'XX']);

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const POSTGREST_CODE_PATTERN = /^PGRST\d{3}$/;

export const readErrorSignals = (error: unknown): ErrorSignals | null => {
  if (!error || typeof error !== 'object') return null;
  const obj = error as { name?: unknown; code?: unknown; status?: unknown };
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    code: typeof obj.code === 'string' ? obj.code : '',
    status: typeof obj.status === 'number' ? obj.status : undefined,
  };
};

/** Reads `message` of an error-like object for display mapping only (never for classification). */
export const readErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  const obj = error as { message?: unknown };
  return typeof obj.message === 'string' ? obj.message : '';
};

/** True for a PostgreSQL SQLSTATE that means a deterministic, rolled-back refusal. */
export const isDeterministicSqlState = (code: string): boolean => {
  if (!SQLSTATE_PATTERN.test(code)) return false;
  if (AUTH_ERROR_CODES.has(code)) return false;
  return !INDETERMINATE_SQLSTATE_CLASSES.has(code.slice(0, 2));
};

/**
 * Detects an unconfirmed network / transport failure using structured signals only:
 * AbortError/TimeoutError, fetch TypeError, transport error codes,
 * HTTP status 0 (supabase-js fetch failure), 408, gateway statuses and other 5xx without a domain SQLSTATE.
 */
export const isNetworkTransportError = (error: unknown): boolean => {
  // fetch() rejects with TypeError on DNS / offline / CORS-level failures
  if (error instanceof TypeError) return true;

  const signals = readErrorSignals(error);
  if (!signals) return false;

  if (TRANSPORT_ERROR_NAMES.has(signals.name)) return true;
  if (TRANSPORT_ERROR_CODES.has(signals.code)) return true;

  const { status } = signals;
  if (status === undefined) return false;
  if (status === 0 || status === 408 || GATEWAY_STATUSES.has(status)) return true;

  if (status >= 500 && status <= 599) {
    // A 5xx carrying a deterministic PostgreSQL SQLSTATE is a domain refusal, not a transport failure
    return !isDeterministicSqlState(signals.code);
  }

  return false;
};

/** Detects 401/403, expired/invalid JWT and PostgreSQL privilege errors. */
export const isAuthFailure = (error: unknown): boolean => {
  const signals = readErrorSignals(error);
  if (!signals) return false;
  return (
    signals.status === 401 ||
    signals.status === 403 ||
    AUTH_ERROR_CODES.has(signals.code)
  );
};

/** True when an auth failure is caused by a missing / expired session rather than missing privileges. */
export const isSessionAuthFailure = (error: unknown): boolean => {
  const signals = readErrorSignals(error);
  if (!signals) return false;
  return signals.status === 401 || SESSION_ERROR_CODES.has(signals.code);
};

/**
 * Classifies a non-validation error: auth → network → deterministic domain refusal → internal.
 * Module mappers handle their own client validation error class before calling this.
 */
export const classifySupabaseError = (error: unknown): Exclude<ApiErrorKind, 'validation'> => {
  if (isAuthFailure(error)) return 'auth';
  if (isNetworkTransportError(error)) return 'network';

  const signals = readErrorSignals(error);
  if (!signals) return 'internal';

  if (isDeterministicSqlState(signals.code)) return 'domain';

  // PostgREST request errors (e.g. PGRST116, PGRST202) with a 4xx status: request rejected before commit
  if (
    POSTGREST_CODE_PATTERN.test(signals.code) &&
    signals.status !== undefined &&
    signals.status >= 400 &&
    signals.status < 500
  ) {
    return 'domain';
  }

  return 'internal';
};

/** True when the server outcome is unknown and a pending idempotency UUID must be preserved. */
export const isIndeterminateErrorKind = (kind: ApiErrorKind): boolean =>
  kind === 'network' || kind === 'auth' || kind === 'internal';
