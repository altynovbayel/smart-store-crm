import { useState, useEffect, useCallback, useRef } from 'react';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

const AUTO_DISMISS_MS = 6000;
const FOCUS_FALLBACK_SELECTOR = '[data-warehouse-search]';

/**
 * Toast notification state for the warehouse page.
 * - Auto-dismisses after 6 seconds, paused while focus is inside the toast.
 * - When dismissed with focus inside, focus returns to the warehouse search field.
 * - Cleared on user / role switch.
 */
export const useWarehouseNotification = (resetKey: string) => {
  const [notification, setNotification] = useState<string | null>(null);
  const [isToastFocused, setIsToastFocused] = useState<boolean>(false);
  const toastRef = useRef<HTMLDivElement>(null);

  const [prevResetKey, setPrevResetKey] = useState<string>(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setNotification(null);
  }

  const dismissNotification = useCallback(() => {
    if (toastRef.current?.contains(document.activeElement)) {
      restoreFocusWithFallback(null, FOCUS_FALLBACK_SELECTOR);
    }
    setNotification(null);
  }, []);

  useEffect(() => {
    if (!notification || isToastFocused) return;
    const timer = setTimeout(() => {
      if (toastRef.current?.contains(document.activeElement)) {
        restoreFocusWithFallback(null, FOCUS_FALLBACK_SELECTOR);
      }
      setNotification(null);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification, isToastFocused]);

  return {
    notification,
    notify: setNotification,
    dismissNotification,
    toastRef,
    setIsToastFocused,
  };
};
