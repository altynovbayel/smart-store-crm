/**
 * Error classification shared by Supabase-backed document modules (Outcome, Sales):
 * - validation: client-side check failed, the request was never sent;
 * - domain: server deterministically refused the operation (transaction rolled back);
 * - network: transport failure or gateway/5xx response, server outcome is unknown;
 * - auth: session expired or insufficient privileges, server outcome is unknown;
 * - internal: unexpected client failure, server outcome is treated as unknown.
 */
export type ApiErrorKind = 'validation' | 'domain' | 'network' | 'auth' | 'internal';

export interface MappedApiError {
  kind: ApiErrorKind;
  message: string;
  field?: string;
}
