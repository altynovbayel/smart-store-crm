import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

const AUTO_DISMISS_MS = 6000;

/**
 * Toast notification state for the outcome page.
 * - Auto-dismisses after 6 seconds, paused while focus is inside the toast.
 * - When dismissed with focus inside, focus returns to the previously focused element or the add button.
 * - Cleared on user switch.
 */
export const useOutcomeNotification = (
  userId: string | null,
  previousFocusRef: RefObject<HTMLElement | null>
) => {
  const [notification, setNotification] = useState<string | null>(null);
  const [isToastFocused, setIsToastFocused] = useState<boolean>(false);
  const toastRef = useRef<HTMLDivElement>(null);

  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setNotification(null);
  }

  const dismissNotification = useCallback(() => {
    if (toastRef.current?.contains(document.activeElement)) {
      restoreFocusWithFallback(previousFocusRef.current, '[data-add-outcome-btn]');
    }
    setNotification(null);
  }, [previousFocusRef]);

  useEffect(() => {
    if (!notification || isToastFocused) return;
    const timer = setTimeout(() => {
      if (toastRef.current?.contains(document.activeElement)) {
        restoreFocusWithFallback(previousFocusRef.current, '[data-add-outcome-btn]');
      }
      setNotification(null);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification, isToastFocused, previousFocusRef]);

  return {
    notification,
    notify: setNotification,
    dismissNotification,
    toastRef,
    setIsToastFocused,
  };
};
