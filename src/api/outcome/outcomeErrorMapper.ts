import type { MappedOutcomeError, OutcomeErrorKind } from '../../types';
import { OutcomeValidationError } from './outcomeValidationError';
import {
  GATEWAY_STATUSES,
  classifySupabaseError,
  isIndeterminateErrorKind,
  isNetworkTransportError as isSharedNetworkTransportError,
  isSessionAuthFailure,
  readErrorSignals,
} from '../shared/supabaseErrorClassifier';

export type { MappedOutcomeError };

export { isAuthFailure } from '../shared/supabaseErrorClassifier';

/**
 * Detects an unconfirmed network / transport failure (shared structural classifier).
 * Client validation errors are never network errors.
 */
export const isNetworkTransportError = (error: unknown): boolean =>
  !(error instanceof OutcomeValidationError) && isSharedNetworkTransportError(error);

/**
 * Classifies any error into an OutcomeErrorKind.
 * Only `validation` and `domain` are deterministic: the operation definitely did not commit.
 */
export const classifyOutcomeError = (error: unknown): OutcomeErrorKind => {
  if (error instanceof OutcomeValidationError) return 'validation';
  return classifySupabaseError(error);
};

/** Returns true when the server outcome is unknown and the pending UUID must be preserved. */
export const isIndeterminateOutcomeError = (error: MappedOutcomeError): boolean =>
  isIndeterminateErrorKind(error.kind);

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
  if (isSessionAuthFailure(error)) {
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
