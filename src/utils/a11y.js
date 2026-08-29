/**
 * DAYSTACK Accessibility (a11y) Manager
 * Implements WCAG compliant modal focus trapping, ARIA roles,
 * and keyboard navigation utilities.
 */

export class A11yManager {
  static activeModalEl = null;
  static previousFocusedEl = null;
  static trapKeyHandler = null;

  /**
   * Traps focus inside a modal element.
   * @param {HTMLElement} modalEl
   */
  static trapFocus(modalEl) {
    if (!modalEl) return;
    this.releaseFocus();

    this.activeModalEl = modalEl;
    this.previousFocusedEl = document.activeElement;

    // Set ARIA attributes
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');

    // Find focusable elements
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = modalEl.querySelectorAll(focusableSelector);
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 50);
    }

    this.trapKeyHandler = (e) => {
      if (e.key !== 'Tab') return;

      const currentFocusables = modalEl.querySelectorAll(focusableSelector);
      if (!currentFocusables.length) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', this.trapKeyHandler);
  }

  /**
   * Releases focus trap and restores focus to previous active element.
   */
  static releaseFocus() {
    if (this.trapKeyHandler) {
      document.removeEventListener('keydown', this.trapKeyHandler);
      this.trapKeyHandler = null;
    }
    if (this.previousFocusedEl && typeof this.previousFocusedEl.focus === 'function') {
      try {
        this.previousFocusedEl.focus();
      } catch (_) {}
      this.previousFocusedEl = null;
    }
    if (this.activeModalEl) {
      this.activeModalEl = null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.A11yManager = A11yManager;
}
