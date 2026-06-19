import { useEffect, useRef, type RefObject } from 'react';

/**
 * Keyboard + focus management for an anchored `role="menu"` popover, shared by
 * the workspace RowMenu, the header view-switcher dropdown, and the file
 * click-menu so they all behave consistently for keyboard / screen-reader
 * users.
 *
 * On open it moves focus to the first `role="menuitem"` inside the container
 * and wires ArrowUp/Down (wrap), Home/End, and Tab-trap. On close it restores
 * focus to whatever was focused when the menu opened (typically the trigger).
 *
 * Escape / outside-click dismissal stays the caller's responsibility (those
 * already exist at every call site) — this hook only owns the in-menu
 * keyboard model and focus restoration. Returns a ref to attach to the menu
 * container element.
 */
export function useMenuKeyboard<T extends HTMLElement>(open: boolean): RefObject<T> {
  const menuRef = useRef<T>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;

    // Remember where focus was so we can restore it on close.
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const items = (): HTMLElement[] =>
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
        (el) => !el.hasAttribute('disabled'),
      );

    // Focus the first item on open.
    items()[0]?.focus();

    const onKey = (e: KeyboardEvent): void => {
      const list = items();
      if (list.length === 0) return;
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        list[(idx + 1 + list.length) % list.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        list[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (e.key === 'Tab') {
        // Trap Tab inside the menu so focus can't silently escape it.
        e.preventDefault();
        const next = e.shiftKey
          ? list[(idx - 1 + list.length) % list.length]
          : list[(idx + 1) % list.length];
        next?.focus();
      }
    };

    menu.addEventListener('keydown', onKey);
    return () => {
      menu.removeEventListener('keydown', onKey);
      // Restore focus to the trigger when the menu closes (it's removed from
      // the DOM, so focus would otherwise fall back to <body>).
      restoreRef.current?.focus?.();
    };
  }, [open]);

  return menuRef;
}
