import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import type { Popover } from './usePopover';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Right-hand reading, e.g. a shortcut. */
  readonly hint?: string;
  /** Accessible name when the visible label alone is ambiguous. */
  readonly ariaLabel?: string;
  readonly testId?: string;
  /** This item is the place the user is already in. */
  readonly current?: boolean;
  readonly disabled?: boolean;
  /** Why it is disabled, shown on hover. */
  readonly disabledReason?: string;
  readonly danger?: boolean;
  readonly onSelect: () => void;
}

export type MenuEntry = MenuItem | 'separator';

/**
 * A popover menu, drawn from data. Presentational: where it sits, when it
 * closes and how focus moves all come from the {@link Popover} it is given.
 */
export function PopoverMenu({
  popover,
  label,
  entries,
  header,
}: {
  readonly popover: Popover<HTMLElement, HTMLDivElement>;
  readonly label: string;
  readonly entries: ReadonlyArray<MenuEntry>;
  /** Non-interactive content above the items. */
  readonly header?: ReactNode;
}): JSX.Element | null {
  if (!popover.open || !popover.style || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={popover.menuRef}
      role="menu"
      aria-label={label}
      className="popover"
      data-instant={popover.instant || undefined}
      style={popover.style}
      // A click in here must not reach the row the menu was opened from.
      onClick={(e) => e.stopPropagation()}
    >
      {header}
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`separator-${index}`} role="separator" className="popover__sep" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className={entry.disabled && entry.disabledReason ? 'menu__row tip' : 'menu__row'}
            data-testid={entry.testId}
            data-active={entry.current || undefined}
            data-danger={entry.danger || undefined}
            data-tip={entry.disabled ? entry.disabledReason : undefined}
            aria-label={entry.ariaLabel}
            aria-current={entry.current ? 'page' : undefined}
            disabled={entry.disabled}
            onClick={() => {
              popover.close();
              entry.onSelect();
            }}
          >
            {entry.icon && (
              <span className="menu__mark" aria-hidden>
                <Icon name={entry.icon} size={15} />
              </span>
            )}
            <span className="menu__text">{entry.label}</span>
            {entry.hint && <span className="menu__hint">{entry.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
