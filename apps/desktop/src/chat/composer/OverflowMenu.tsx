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
          padding: '6px 9px',
          lineHeight: 1,
          border: `1px solid ${armed ? 'var(--color-primary)' : 'var(--color-card-border)'}`,
          borderRadius: 10,
          background: armed ? 'var(--color-primary-soft)' : 'var(--color-surface)',
          color: armed ? 'var(--color-primary-strong)' : 'var(--color-text-muted)',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <Icon name="plus" size={16} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            zIndex: 30,
            minWidth: 196,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 4,
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.4)',
          }}
        >
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
      className="btn-chip"
      disabled={item.disabled}
      onClick={onClick}
      style={rowStyle(item.active, item.disabled)}
    >
      <Icon name={item.icon} size={15} />
      <span>{item.label}</span>
      {item.active && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
          <Icon name="check" size={14} />
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
        className="btn-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={item.disabled}
        onClick={onToggle}
        style={rowStyle(item.active, item.disabled)}
      >
        <Icon name={item.icon} size={15} />
        <span>{item.label}:</span>
        <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>
          {submenu.value || '—'}
        </span>
        <span
          aria-hidden
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            color: 'var(--color-text-dim)',
            transform: open ? 'rotate(90deg)' : undefined,
            transition: 'transform 120ms ease',
          }}
        >
          <Icon name="chevron-right" size={14} />
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={item.label}
          style={{
            position: 'absolute',
            left: 'calc(100% + 6px)',
            bottom: 0,
            zIndex: 31,
            minWidth: 168,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 4,
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.4)',
          }}
        >
          {submenu.options.map((opt) => {
            const active = opt === submenu.value;
            return (
              <button
                key={opt}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelect(opt)}
                style={rowStyle(active, false)}
              >
                <span style={{ flex: 1 }}>{opt}</span>
                {active && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Shared row styling for menu + submenu options. */
function rowStyle(active = false, disabled = false): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    padding: '8px 10px',
    fontSize: 12.5,
    fontWeight: 600,
    lineHeight: 1,
    textAlign: 'left',
    border: 'none',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    background: active ? 'var(--color-primary-soft)' : 'transparent',
    color: active ? 'var(--color-primary-strong)' : 'var(--color-text)',
  };
}
