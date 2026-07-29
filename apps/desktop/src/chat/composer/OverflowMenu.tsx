import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';

export interface OverflowMenuItem {
  readonly icon: IconName;
  readonly label: string;
  /** Fired on click for a plain row. Omitted for a `submenu` disclosure row. */
  readonly onClick?: () => void;
  /** Toggle-style item that is currently on (e.g. Auto-approve). Tints
   *  the row and shows a trailing check. */
  readonly active?: boolean;
  /** Greyed + non-interactive (e.g. Mode while a turn is in flight). */
  readonly disabled?: boolean;
  /** Turns the row into a disclosure that expands a nested list of options
   *  to the side (e.g. Mode). The active option is checked; picking one
   *  commits via `onSelect` and closes the whole menu. */
  readonly submenu?: {
    readonly value: string;
    readonly options: ReadonlyArray<string>;
    readonly onSelect: (value: string) => void;
  };
}

interface OverflowMenuProps {
  readonly items: ReadonlyArray<OverflowMenuItem>;
  readonly disabled?: boolean;
  /** Tint the trigger even while collapsed so an active toggle inside
   *  (e.g. Auto-approve ON) stays visible without opening the menu. */
  readonly highlighted?: boolean;
}

/**
 * The composer's "+" overflow button. Collapses the less-frequent tools
 * (Actions / Goal / Auto-approve / Mode) into a single left-aligned trigger
 * that opens a small popover above it, keeping the toolbar compact. A `submenu`
 * item (Mode) discloses its options as a flyout to the side. Closes on
 * outside-click, Escape, or item selection.
 */
export function OverflowMenu({
  items,
  disabled = false,
  highlighted = false,
}: OverflowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  // Label of the row whose nested option list is currently expanded (Mode), or
  // null. Only one submenu opens at a time; closing the menu collapses it.
  const [openSub, setOpenSub] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const closeAll = (): void => {
    setOpen(false);
    setOpenSub(null);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) closeAll();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Escape backs out one level: collapse an open submenu first, then the
      // whole menu.
      if (openSub) setOpenSub(null);
      else setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, openSub]);

  const armed = highlighted || open;
  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="btn-chip"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setOpenSub(null);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 'var(--frame-control)',
          height: 'var(--frame-control)',
          padding: 0,
          lineHeight: 1,
          border: `1px solid ${armed ? 'var(--color-primary)' : 'var(--color-card-border)'}`,
          borderRadius: 'var(--radius-block)',
          background: armed ? 'var(--color-primary-soft)' : 'var(--color-surface)',
          color: armed ? 'var(--color-primary-strong)' : 'var(--color-text-muted)',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <Icon name="plus" size={16} />
      </button>
      {open && (
        <div role="menu" className="menu menu--up">
          <div className="menu__label">Turn</div>
          {items.map((item) =>
            item.submenu ? (
              <SubmenuRow
                key={item.label}
                item={item}
                submenu={item.submenu}
                open={openSub === item.label}
                onToggle={() =>
                  setOpenSub((s) => (s === item.label ? null : item.label))
                }
                onSelect={(value) => {
                  closeAll();
                  item.submenu?.onSelect(value);
                }}
              />
            ) : (
              <MenuRow
                key={item.label}
                item={item}
                onClick={() => {
                  closeAll();
                  item.onClick?.();
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A plain action row (Actions / Goal / Auto-approve). */
function MenuRow({
  item,
  onClick,
}: {
  readonly item: OverflowMenuItem;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu__row"
      data-active={item.active ? 'true' : undefined}
      disabled={item.disabled}
      onClick={onClick}
    >
      <Icon name={item.icon} size={14} />
      <span className="menu__text">{item.label}</span>
      {item.active && (
        <span className="menu__mark" aria-hidden>
          <Icon name="check" size={13} />
        </span>
      )}
    </button>
  );
}

/** A disclosure row (Mode) whose options expand as a flyout to the side. */
function SubmenuRow({
  item,
  submenu,
  open,
  onToggle,
  onSelect,
}: {
  readonly item: OverflowMenuItem;
  readonly submenu: NonNullable<OverflowMenuItem['submenu']>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (value: string) => void;
}): JSX.Element {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        role="menuitem"
        className="menu__row"
        data-active={item.active ? 'true' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={item.disabled}
        onClick={onToggle}
      >
        <Icon name={item.icon} size={14} />
        <span className="menu__text">{item.label}</span>
        {/* The current value reads as the row's right-hand column, the same shape
            the telemetry cells use: label on the left, reading on the right. */}
        <span className="menu__value">{submenu.value || '—'}</span>
        <span
          aria-hidden
          className="menu__mark"
          style={{
            transform: open ? 'rotate(90deg)' : undefined,
            transition: 'transform var(--motion-shift) ease',
          }}
        >
          <Icon name="chevron-right" size={13} />
        </span>
      </button>
      {open && (
        <div role="menu" aria-label={item.label} className="menu menu--side">
          {submenu.options.map((opt) => {
            const active = opt === submenu.value;
            return (
              <button
                key={opt}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelect(opt)}
                className="menu__row"
                data-active={active ? 'true' : undefined}
              >
                <span className="menu__text">{opt}</span>
                {active && (
                  <span className="menu__mark" aria-hidden>
                    <Icon name="check" size={13} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

