import type { MappedApiError } from '../../types';
import {
  GATEWAY_STATUSES,
  classifySupabaseError,
  isSessionAuthFailure,
  readErrorSignals,
} from '../shared/supabaseErrorClassifier';

/** Raised by the mappers when an RPC response is malformed or exceeds safe integer bounds. */
export class DashboardDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardDataError';
  }
}

/**
 * Maps Dashboard RPC / mapping errors to safe Russian messages (read-only data, nothing to retry
 * idempotently — every kind can simply be retried by the user).
 */
export const mapDashboardError = (error: unknown): MappedApiError => {
  if (error instanceof DashboardDataError) {
    return { kind: 'internal', message: error.message };
  }

  switch (classifySupabaseError(error)) {
    case 'auth':
      return {
        kind: 'auth',
        message: isSessionAuthFailure(error)
          ? 'Сессия истекла или требуется повторная авторизация. Пожалуйста, выполните вход заново.'
          : 'Недостаточно прав для просмотра показателей. Учётная запись неактивна или доступ ограничен.',
      };
    case 'network': {
      const status = readErrorSignals(error)?.status;
      return {
        kind: 'network',
        message:
          status !== undefined && GATEWAY_STATUSES.has(status)
            ? 'Сервер временно недоступен. Повторите попытку позже.'
            : 'Ошибка сети при загрузке показателей. Проверьте подключение к интернету.',
      };
    }
    case 'domain':
      return { kind: 'domain', message: 'Сервер отклонил запрос показателей. Обновите страницу.' };
    default:
      return { kind: 'internal', message: 'Не удалось загрузить показатели. Повторите попытку.' };
  }
};
