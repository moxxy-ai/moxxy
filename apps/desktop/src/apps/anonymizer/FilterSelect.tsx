import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';

/** One selectable filter row in the multi-select. `hint` surfaces a secondary
 *  line (e.g. the on-device NER status) without crowding the label. */
export interface FilterOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly hint?: string;
  /** When set the row is shown but cannot be toggled (e.g. NER unavailable). */
  readonly disabled?: boolean;
}

/**
 * A compact multi-select dropdown — the redaction filters.
 *
 * Replaces the old long row of raw toggles: the trigger is a single chip
 * showing how many filters are active ("Filters · 9"), and the panel is an ARIA
 * `listbox` of `option` rows (toggle = select), plus All / None shortcuts.
 *
 * Keyboard: the trigger opens with Enter/Space; inside the panel Up/Down/Home/End
 * move a roving focus between rows, Enter/Space toggle the focused filter, and
 * Escape (or outside-click) closes and restores focus to the trigger so a
 * keyboard/screen-reader user is never stranded on <body>.
 *
 * Anchored-dropdown mechanics mirror RailMenu / the header's collapsible
 * Segmented: outside-click + Escape dismiss. The panel is absolutely
 * positioned and the wrapper is lifted (`zIndex` while open) because an
 * ancestor `transform` (the app shell) would otherwise trap the panel in a
 * local stacking context and let page content paint over it.
 */
export function FilterSelect<Id extends string>({
  options,
  selected,
  onChange,
  testId = 'anon-filter-select',
}: {
  readonly options: ReadonlyArray<FilterOption<Id>>;
  readonly selected: ReadonlySet<Id>;
  readonly onChange: (next: ReadonlySet<Id>) => void;
  readonly testId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Roving-tabindex focus position within the option list.
  const [activeIndex, setActiveIndex] = useState(0);
  // Which row currently holds DOM focus (-1 = none) — drives the visible focus
  // ring inline, since the global `button:focus-visible` rule can't reach a
  // `role="option"` <div> and the surrounding stylesheet is out of scope here.
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const labelId = useId();

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    // Return focus to the trigger so the popup focus-return contract holds —
    // otherwise focus drops to <body> and keyboard users lose their anchor.
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Dismiss on outside-click / Escape — the shared anchored-dropdown pattern.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // When the panel opens, land the roving focus on the first selected row (or
  // the first row) and move DOM focus there so arrow keys work immediately.
  useLayoutEffect(() => {
    if (!open) return;
    const firstSelected = options.findIndex((o) => !o.disabled && selected.has(o.id));
    const firstEnabled = options.findIndex((o) => !o.disabled);
    const start = firstSelected >= 0 ? firstSelected : Math.max(0, firstEnabled);
    setActiveIndex(start);
    optionRefs.current[start]?.focus();
    // Only on open — re-running on every selection change would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const focusIndex = (i: number, dir: 1 | -1 = 1): void => {
    const n = options.length;
    if (n === 0) return;
    // Skip disabled rows in the travel direction, wrapping around.
    let next = ((i % n) + n) % n;
    let guard = 0;
    while (options[next]?.disabled && guard < n) {
      next = (next + dir + n) % n;
      guard += 1;
    }
    if (options[next]?.disabled) return; // every row disabled — nothing to focus
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const selectable = options.filter((o) => !o.disabled);
  const activeCount = selectable.filter((o) => selected.has(o.id)).length;
  const allOn = activeCount === selectable.length && selectable.length > 0;

  const toggle = (id: Id): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const setAll = (on: boolean): void => {
    const next = new Set(selected);
    for (const o of selectable) {
      if (on) next.add(o.id);
      else next.delete(o.id);
    }
    onChange(next);
  };

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', zIndex: open ? 50 : undefined, alignSelf: 'flex-start' }}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn-chip"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 10,
          color: 'var(--color-text)',
          background: 'var(--color-surface)',
          border: `1px solid ${open ? 'var(--color-accent)' : 'var(--color-card-border)'}`,
          transition: 'border-color 140ms ease',
        }}
      >
        <Icon name="sliders" size={14} />
        <span>Filters</span>
        <span
          data-testid={`${testId}-count`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 20,
            height: 20,
            padding: '0 6px',
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 700,
            color: activeCount > 0 ? '#fff' : 'var(--color-text-muted)',
            background:
              activeCount > 0
                ? 'var(--color-primary-strong)'
                : 'color-mix(in oklab, var(--color-text-dim) 14%, transparent)',
          }}
        >
          {activeCount}
        </span>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(-90deg)' : 'rotate(90deg)',
            transition: 'transform 120ms ease',
            color: 'var(--color-text-muted)',
          }}
        >
          <Icon name="chevron-right" size={14} />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          aria-labelledby={labelId}
          data-testid={`${testId}-panel`}
          onKeyDown={(e) => {
            switch (e.key) {
              case 'ArrowDown':
                e.preventDefault();
                focusIndex(activeIndex + 1, 1);
                break;
              case 'ArrowUp':
                e.preventDefault();
                focusIndex(activeIndex - 1, -1);
                break;
              case 'Home':
                e.preventDefault();
                focusIndex(0, 1);
                break;
              case 'End':
                e.preventDefault();
                focusIndex(options.length - 1, -1);
                break;
              default:
                break;
            }
          }}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            width: 300,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.45)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '10px 12px',
              borderBottom: '1px solid var(--color-card-border)',
            }}
          >
            <span id={labelId} style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
              What to redact
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                data-testid={`${testId}-all`}
                onClick={() => setAll(true)}
                disabled={allOn}
                style={miniBtn(allOn)}
              >
                All
              </button>
              <span style={{ color: 'var(--color-text-dim)', fontSize: 11 }}>·</span>
              <button
                type="button"
                data-testid={`${testId}-none`}
                onClick={() => setAll(false)}
                disabled={activeCount === 0}
                style={miniBtn(activeCount === 0)}
              >
                None
              </button>
            </div>
          </div>

          <div style={{ overflowY: 'auto', padding: 4 }}>
            {options.map((o, i) => {
              const checked = selected.has(o.id);
              return (
                <div
                  key={o.id}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={o.disabled || undefined}
                  data-testid={`${testId}-opt-${o.id}`}
                  className="row-button"
                  // Roving tabindex: exactly one row is in the tab order at a time
                  // so Tab enters/leaves the list while arrows move within it.
                  tabIndex={o.disabled ? -1 : i === activeIndex ? 0 : -1}
                  onClick={() => {
                    if (o.disabled) return;
                    setActiveIndex(i);
                    toggle(o.id);
                  }}
                  onKeyDown={(e) => {
                    if (o.disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(o.id);
                    }
                  }}
                  onFocus={() => setFocusedIndex(i)}
                  onBlur={() => setFocusedIndex((cur) => (cur === i ? -1 : cur))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: o.disabled ? 'not-allowed' : 'pointer',
                    opacity: o.disabled ? 0.55 : 1,
                    outline: focusedIndex === i ? '2px solid var(--color-primary)' : 'none',
                    outlineOffset: -2,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      border: checked
                        ? '1px solid var(--color-primary-strong)'
                        : '1px solid var(--color-card-border-strong)',
                      background: checked ? 'var(--color-primary-strong)' : 'transparent',
                      transition: 'background 120ms, border-color 120ms',
                    }}
                  >
                    {checked && <Icon name="check" size={12} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text)' }}>{o.label}</span>
                  {o.hint && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-dim)', flexShrink: 0 }}>
                      {o.hint}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function miniBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '2px 6px',
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 6,
    color: disabled ? 'var(--color-text-dim)' : 'var(--color-accent-strong)',
    background: 'transparent',
    cursor: disabled ? 'default' : 'pointer',
  };
}
