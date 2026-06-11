import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';

export interface OverflowMenuItem {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
  /** Toggle-style item that is currently on (e.g. Auto-approve). Tints
   *  the row and shows a trailing check. */
  readonly active?: boolean;
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
 * (Actions / Goal / Auto-approve) into a single left-aligned trigger that
 * opens a small popover above it, keeping the toolbar compact. Closes on
 * outside-click, Escape, or item selection.
 */
export function OverflowMenu({
  items,
  disabled = false,
  highlighted = false,
}: OverflowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        onClick={() => setOpen((o) => !o)}
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
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="btn-chip"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              style={{
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
                cursor: 'pointer',
                background: item.active ? 'var(--color-primary-soft)' : 'transparent',
                color: item.active
                  ? 'var(--color-primary-strong)'
                  : 'var(--color-text)',
              }}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.active && (
                <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
                  <Icon name="check" size={14} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
