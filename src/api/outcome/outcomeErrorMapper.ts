import type { MappedOutcomeError, OutcomeErrorKind } from '../../types';
import { OutcomeValidationError } from './outcomeValidationError';

export type { MappedOutcomeError };

/**
 * Structured view of an error object. Classification relies only on
 * `name`, `code` and `status` — never on free text, because PostgreSQL
 * messages may contain product names and other user data.
 */
interface ErrorSignals {
  name: string;
  code: string;
  status: number | undefined;
}

/** Gateway / edge responses: the request may or may not have reached PostgreSQL. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

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

/**
 * SQLSTATE classes where the transaction outcome cannot be treated as a deterministic refusal:
 * 08 connection exception, 40 transaction rollback, 53 insufficient resources,
 * 57 operator intervention (incl. statement timeout), 58 system error, XX internal error.
 */
const INDETERMINATE_SQLSTATE_CLASSES: ReadonlySet<string> = new Set(['08', '40', '53', '57', '58', 'XX']);

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const POSTGREST_CODE_PATTERN = /^PGRST\d{3}$/;

const readErrorSignals = (error: unknown): ErrorSignals | null => {
  if (!error || typeof error !== 'object') return null;
  const obj = error as { name?: unknown; code?: unknown; status?: unknown };
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    code: typeof obj.code === 'string' ? obj.code : '',
    status: typeof obj.status === 'number' ? obj.status : undefined,
  };
};

/** True for a PostgreSQL SQLSTATE that means a deterministic, rolled-back refusal. */
const isDeterministicSqlState = (code: string): boolean => {
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
  if (error instanceof OutcomeValidationError) return false;

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

/**
 * Detects 401/403, expired/invalid JWT and PostgreSQL privilege errors.
 */
export const isAuthFailure = (error: unknown): boolean => {
  const signals = readErrorSignals(error);
  if (!signals) return false;
  return (
    signals.status === 401 ||
    signals.status === 403 ||
    AUTH_ERROR_CODES.has(signals.code)
  );
};

/**
 * Classifies any error into an OutcomeErrorKind.
 * Only `validation` and `domain` are deterministic: the operation definitely did not commit.
 */
export const classifyOutcomeError = (error: unknown): OutcomeErrorKind => {
  if (error instanceof OutcomeValidationError) return 'validation';
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

/** Returns true when the server outcome is unknown and the pending UUID must be preserved. */
export const isIndeterminateOutcomeError = (error: MappedOutcomeError): boolean =>
  error.kind === 'network' || error.kind === 'auth' || error.kind === 'internal';

const mapNetworkError = (error: unknown): MappedOutcomeError => {
  const status = readErrorSignals(error)?.status;
  if (status !== undefined && GATEWAY_STATUSES.has(status)) {
    return {
      kind: 'network',
      message:
        'Ошибка связи с сервером (шлюз недоступен). Результат операции не подтверждён — проверьте статус после восстановления связи.',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: 'network',
      message: 'Внутренняя ошибка сервера. Результат операции не подтверждён — проверьте статус списания.',
    };
  }
  return {
    kind: 'network',
    message: 'Ошибка сети или связи с сервером. Проверьте подключение к интернету и повторите попытку.',
  };
};

const mapAuthError = (error: unknown): MappedOutcomeError => {
  const signals = readErrorSignals(error);
  const isSessionProblem =
    signals?.status === 401 ||
    signals?.code === 'PGRST301' ||
    signals?.code === 'PGRST302' ||
    signals?.code === 'PGRST303' ||
    signals?.code === '28000';

  if (isSessionProblem) {
    return {
      kind: 'auth',
      message: 'Сессия истекла или требуется повторная авторизация. Пожалуйста, выполните вход заново.',
    };
  }
  return {
    kind: 'auth',
    message: 'Недостаточно прав для выполнения данной операции. Требуются права администратора.',
  };
};

/**
 * Maps a deterministic server refusal to a user-facing message.
 * Message text is used only to pick a friendly description — classification is already done.
 */
const mapDomainError = (error: unknown): MappedOutcomeError => {
  const errObj = error as { message?: unknown; details?: unknown; code?: unknown };
  const message = typeof errObj.message === 'string' ? errObj.message : '';
  const code = typeof errObj.code === 'string' ? errObj.code : '';

  if (message.startsWith('Validation error: Outcome document date cannot be in the future')) {
    return { kind: 'domain', message: 'Дата списания не может быть в будущем.', field: 'documentDate' };
  }

  if (message.startsWith('Validation error: Outcome reason is required')) {
    return { kind: 'domain', message: 'Укажите причину списания.', field: 'reason' };
  }

  if (message.startsWith('Validation error: Reason comment is required')) {
    return {
      kind: 'domain',
      message: 'Для причины «Другое» необходимо указать подробный комментарий.',
      field: 'comment',
    };
  }

  if (message.startsWith('Validation error: Outcome document must contain at least one line item')) {
    return {
      kind: 'domain',
      message: 'Документ списания должен содержать хотя бы одну позицию товара.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Duplicate product in outcome document items')) {
    return {
      kind: 'domain',
      message: 'В документе списания содержатся повторяющиеся товары. Объедините позиции.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Cannot write off archived product')) {
    return {
      kind: 'domain',
      message: 'Невозможно списать архивированный товар. Восстановите товар на складе или выберите другой.',
      field: 'itemsGeneral',
    };
  }

  if (code === 'P0002' || code === 'PGRST116') {
    return {
      kind: 'domain',
      message: 'Документ списания или выбранные товары не найдены в базе данных.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Insufficient stock for write-off')) {
    // All products are counted in pieces: the catalog has no unit column (see warehouseMappers)
    const match = message.match(
      /^Insufficient stock for write-off of product "(.*)" \(available: (\d+), requested: (\d+)\)$/
    );
    if (match) {
      const [, prodName, avail, req] = match;
      return {
        kind: 'domain',
        message: `Недостаточный остаток для списания товара «${prodName}» (доступно: ${avail} шт., запрошено: ${req} шт.). Пожалуйста, обновите остатки.`,
        field: 'itemsGeneral',
      };
    }
    return {
      kind: 'domain',
      message: 'Недостаточный остаток товара на складе для выполнения списания. Пожалуйста, обновите остатки.',
      field: 'itemsGeneral',
    };
  }

  if (
    message.startsWith('Validation error: Write-off at') &&
    message.includes('negative')
  ) {
    return {
      kind: 'domain',
      message:
        'Невозможно провести списание указанной датой: это приведёт к отрицательному остатку товара в этот день или в последующих операциях.',
      field: 'documentDate',
    };
  }

  if (message.startsWith('Validation error: Quantity must be positive')) {
    return {
      kind: 'domain',
      message: 'Количество товара должно быть целым положительным числом не более 100 000 000 шт.',
      field: 'itemsGeneral',
    };
  }

  if (
    message.startsWith('Validation error: Line cost exceeds safe number bounds') ||
    message.startsWith('Validation error: Outcome total cost exceeds safe number bounds')
  ) {
    return {
      kind: 'domain',
      message: 'Общая сумма списания превышает допустимый математический предел.',
      field: 'itemsGeneral',
    };
  }

  if (code === '23505') {
    return {
      kind: 'domain',
      message: 'Акт списания с таким номером или идентификатором уже зарегистрирован.',
    };
  }

  return {
    kind: 'domain',
    message: 'Сервер отклонил операцию списания. Проверьте данные документа и повторите попытку.',
  };
};

/**
 * Maps client validation, PostgreSQL and Supabase errors to safe, user-facing Russian messages
 * without exposing internal SQL, database structure, constraints or stack traces.
 */
export const mapOutcomeError = (error: unknown): MappedOutcomeError => {
  if (error instanceof OutcomeValidationError) {
    return { kind: 'validation', message: error.message, field: error.field };
  }

  switch (classifyOutcomeError(error)) {
    case 'auth':
      return mapAuthError(error);
    case 'network':
      return mapNetworkError(error);
    case 'domain':
      return mapDomainError(error);
    default:
      return {
        kind: 'internal',
        message:
          'Произошла непредвиденная ошибка. Результат операции не подтверждён — проверьте статус списания.',
      };
  }
};
