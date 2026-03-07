import { type RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus within a container element while active.
 * When the user presses Tab on the last focusable element, focus wraps to the first.
 * When the user presses Shift+Tab on the first focusable element, focus wraps to the last.
 *
 * @param ref - Ref to the container element
 * @param isActive - Whether the focus trap is active (e.g. modal is open)
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, isActive: boolean): void {
  useEffect(() => {
    if (!isActive || !ref.current) return;

    const container = ref.current;

    // Small delay to ensure DOM is settled before focusing
    const initialFocusTimer = setTimeout(() => {
      const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const firstElement = focusableElements[0];
      if (firstElement && !container.contains(document.activeElement)) {
        firstElement.focus();
      }
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(initialFocusTimer);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, ref]);
}
