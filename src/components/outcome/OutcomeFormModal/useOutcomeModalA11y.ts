import { useEffect, type RefObject } from 'react';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface UseOutcomeModalA11yOptions {
  isOpen: boolean;
  modalRef: RefObject<HTMLDivElement | null>;
  isSubmittingRef: RefObject<boolean>;
  onClose: () => void;
}

/**
 * Modal accessibility for the outcome form:
 * initial focus on the reason select, Tab/Shift+Tab focus trap, Escape to close
 * (blocked while submitting), background scroll lock and focus restoration on close.
 */
export const useOutcomeModalA11y = ({
  isOpen,
  modalRef,
  isSubmittingRef,
  onClose,
}: UseOutcomeModalA11yOptions) => {
  useEffect(() => {
    if (!isOpen) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    document.body.classList.add('drawer-open');

    // Focus first input if focus is not already inside the modal
    const isFocusInside = modalRef.current?.contains(document.activeElement);
    if (!isFocusInside) {
      const reasonSelect = modalRef.current?.querySelector<HTMLSelectElement>('#out-reason');
      reasonSelect?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmittingRef.current) {
          onClose();
        }
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) {
          e.preventDefault();
          modalRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // If focus escaped the dialog container, pull it back in
        if (!modalRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusWithFallback(previousFocus, '[data-add-outcome-btn]');
    };
  }, [isOpen, onClose, modalRef, isSubmittingRef]);
};
