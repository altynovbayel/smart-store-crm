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

const isElementInteractive = (el: HTMLElement): boolean => {
  if (
    'disabled' in el &&
    (el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled
  ) {
    return false;
  }
  return isElementVisible(el);
};

/**
 * Finds the currently visible and enabled "Add product", "Add income", or "Add outcome" button on the page.
 * Avoids buttons hidden by responsive CSS (e.g. mobile breakpoints) or disabled during loading/errors.
 */
export const getVisibleAddButton = (
  selector: string = '[data-add-product-btn], [data-add-income-btn], [data-add-outcome-btn], [data-add-sale-btn]'
): HTMLElement | null => {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(selector)
  ).filter(isElementInteractive);

  const visible = candidates.find(isElementVisible);

  return (
    visible ??
    candidates.find((el) => window.getComputedStyle(el).display !== 'none') ??
    candidates[0] ??
    null
  );
};

export const getVisibleAddProductButton = (): HTMLElement | null => {
  return getVisibleAddButton('[data-add-product-btn]');
};

export const getVisibleAddOutcomeButton = (): HTMLElement | null => {
  return getVisibleAddButton('[data-add-outcome-btn]');
};

export const getVisibleAddSaleButton = (): HTMLElement | null => {
  return getVisibleAddButton('[data-add-sale-btn]');
};

/**
 * Restores focus to the previously active element if it's still attached to the DOM,
 * visible, and interactive (not disabled), otherwise falls back to the visible action button.
 * If all action buttons are disabled or hidden, falls back to the first visible search input.
 */
export const restoreFocusWithFallback = (
  previousElement: HTMLElement | null,
  fallbackSelector: string = '[data-add-product-btn], [data-add-income-btn], [data-add-outcome-btn], [data-add-sale-btn]'
): void => {
  if (
    previousElement &&
    document.contains(previousElement) &&
    isElementInteractive(previousElement)
  ) {
    previousElement.focus();
    if (document.activeElement === previousElement) {
      return;
    }
  }

  const fallbackBtn = getVisibleAddButton(fallbackSelector);
  if (fallbackBtn && isElementInteractive(fallbackBtn)) {
    fallbackBtn.focus();
    if (document.activeElement === fallbackBtn) {
      return;
    }
  }

  // If no action button is found or it is disabled, fall back to first visible and enabled search input
  const searchInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="search"]:not(:disabled)')
  );
  const visibleSearch = searchInputs.find(isElementInteractive);
  if (visibleSearch) {
    visibleSearch.focus();
  }
};

/**
 * Returns focusable and currently interactive (not disabled, not hidden) elements within a container.
 */
export const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    )
  );
  return elements.filter(isElementVisible);
};
