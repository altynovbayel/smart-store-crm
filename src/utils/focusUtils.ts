/**
 * Utility functions for accessible focus management.
 */

/**
 * Checks whether an element is currently visible and capable of receiving focus.
 */
export const isElementVisible = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  return (
    element.offsetWidth > 0 ||
    element.offsetHeight > 0 ||
    element.getClientRects().length > 0
  );
};

/**
 * Finds the currently visible "Add product" button on the page.
 * Avoids buttons hidden by responsive CSS (e.g. mobile breakpoints).
 */
export const getVisibleAddProductButton = (): HTMLElement | null => {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[data-add-product-btn]')
  );

  const visible = candidates.find(isElementVisible);

  return (
    visible ??
    candidates.find((el) => window.getComputedStyle(el).display !== 'none') ??
    candidates[0] ??
    null
  );
};

/**
 * Restores focus to the previously active element if it's still attached to the DOM
 * and visible, otherwise falls back to the visible "Add product" button.
 */
export const restoreFocusWithFallback = (previousElement: HTMLElement | null): void => {
  if (
    previousElement &&
    document.contains(previousElement) &&
    isElementVisible(previousElement)
  ) {
    previousElement.focus();
    return;
  }

  const fallbackBtn = getVisibleAddProductButton();
  fallbackBtn?.focus();
};
