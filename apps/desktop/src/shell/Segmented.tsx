import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { useMenuKeyboard } from './useMenuKeyboard';

/**
 * Segmented pill nav — a recessed track with a raised active segment, used for
 * SUB-navigation inside a pane (settings tabs, automations kinds, the appearance
 * theme toggle). Top-level navigation is the app rail's job, not this control's:
 * the view switcher that used to lead every header is gone. `value: null`
 * renders with no active segment.
 *
 * Pass `collapsible` to make it responsive: when the inline pill row would
 * overflow its allotted width (a narrow window), the whole group folds into
 * a single compact button — the active tab's label + a chevron — that opens
 * a dropdown listing every tab. Nothing ever clips off-screen. At wide
 * widths it renders the inline pills exactly as before. Non-collapsible
 * call sites (Appearance theme toggle) are untouched.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
  collapsible = false,
  collapsedLabel = 'Menu',
  disabledIds,
  disabledReason,
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
  /** Fold into a dropdown when the inline row doesn't fit. Default off. */
  readonly collapsible?: boolean;
  /** Button label when collapsed and no tab is active (e.g. switcher on Settings). */
  readonly collapsedLabel?: string;
  readonly disabledIds?: ReadonlySet<T> | ReadonlyArray<T>;
  readonly disabledReason?: string;
}): JSX.Element {
  if (!collapsible) {
    return (
      <PillRow
        items={items}
        value={value}
        onChange={onChange}
        testIdPrefix={testIdPrefix}
        disabledIds={disabledIds}
        disabledReason={disabledReason}
      />
    );
  }

  return (
    <CollapsibleSegmented
      items={items}
      value={value}
      onChange={onChange}
      testIdPrefix={testIdPrefix}
      collapsedLabel={collapsedLabel}
      disabledIds={disabledIds}
      disabledReason={disabledReason}
    />
  );
}

/** The inline grey-track / white-pill row — the un-collapsed look. When
 *  `measureOnly` it is rendered solely so the responsive wrapper can read its
 *  natural width (the parent hides it): it drops the testids — so they don't
 *  duplicate the dropdown's — and is taken out of the tab order. */
function PillRow<T extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
  measureOnly = false,
  disabledIds,
  disabledReason,
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
  readonly measureOnly?: boolean;
  readonly disabledIds?: ReadonlySet<T> | ReadonlyArray<T>;
  readonly disabledReason?: string;
}): JSX.Element {
  return (
    <nav
      aria-hidden={measureOnly || undefined}
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        background: 'var(--color-app-bg)',
        borderRadius: 12,
      }}
    >
      {items.map((t) => {
        const active = value === t.id;
        const disabled = isDisabledId(disabledIds, t.id);
        return (
          <button
            key={t.id}
            type="button"
            data-testid={measureOnly ? undefined : `${testIdPrefix}${t.id}`}
            data-active={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            tabIndex={measureOnly ? -1 : undefined}
            onClick={() => {
              if (!disabled) onChange(t.id);
            }}
            style={pillStyle(active, disabled)}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function pillStyle(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '6px 15px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 'var(--radius-block)',
    whiteSpace: 'nowrap',
    color: disabled
      ? 'color-mix(in oklab, var(--color-text-muted) 62%, transparent)'
      : active
        ? 'var(--color-text)'
        : 'var(--color-text-muted)',
    background: active ? 'var(--color-surface)' : 'transparent',
    // A seam, not a drop shadow: nothing flat in this language casts one.
    boxShadow: active ? 'inset 0 0 0 1px var(--color-card-border)' : 'none',
    cursor: disabled ? 'not-allowed' : undefined,
    opacity: disabled ? 0.62 : undefined,
    transition: 'background 140ms, color 140ms',
  };
}

/**
 * The responsive shell around an inline Segmented row.
 *
 * Fit detection: the inline row is ALWAYS mounted as a measuring layer at its
 * natural width (`flex-shrink:0`) inside a shrinkable, clipping outer box whose
 * width tracks the available slot. `collapsed = row's natural width >
 * box's available width`. Crucially the measuring layer stays mounted even while
 * collapsed (hidden via `visibility`, but still laid out), so `available >=
 * natural` is detected the instant room returns.
 *
 * This is the fix for the earlier "collapsed all the time / stuck on wide
 * screens" bug: the previous version unmounted the live row on collapse and
 * remembered a stale natural width, while the box then shrink-wrapped the small
 * collapsed button — so `available` looked tiny and it could never tell it would
 * fit again. Any transient narrow moment (window opening, a resize) wedged it
 * collapsed forever.
 *
 * In a DOM without ResizeObserver (jsdom unit env) it stays expanded — the
 * wide-window default — so existing tab-by-testid tests keep passing.
 */
function CollapsibleSegmented<T extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
  collapsedLabel,
  disabledIds,
  disabledReason,
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
  readonly collapsedLabel: string;
  readonly disabledIds?: ReadonlySet<T> | ReadonlyArray<T>;
  readonly disabledReason?: string;
}): JSX.Element {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  // Focus into the popover on open + restore focus to the trigger on close,
  // with arrow-key navigation between items.
  const menuListRef = useMenuKeyboard<HTMLDivElement>(open);

  // Re-evaluate fit on slot/window resize and whenever the items/value change.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const measure = measureRef.current;
    if (!outer || !measure) return;
    if (typeof ResizeObserver === 'undefined') return; // jsdom — stay expanded.

    const evaluate = (): void => {
      // The measuring layer is always mounted at the row's natural width, so
      // this reads the true content width whether or not we're collapsed; the
      // outer box's clientWidth is the available slot (it shrinks below content
      // via min-width:0). +1 slack absorbs sub-pixel rounding.
      const natural = measure.scrollWidth;
      const available = outer.clientWidth;
      if (natural <= 0 || available <= 0) return; // pre-layout — don't flip
      setCollapsed(natural > available + 1);
    };

    evaluate();
    const ro = new ResizeObserver(evaluate);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [items, value]);

  // When folded open, dismiss on outside-click / Escape — matching RailMenu /
  // the workspace RowMenu anchored-dropdown pattern.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!menuRootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close the menu if a resize folds the group back out (the trigger is gone).
  useEffect(() => {
    if (!collapsed) setOpen(false);
  }, [collapsed]);

  const activeLabel = items.find((t) => t.id === value)?.label ?? collapsedLabel;

  return (
    <div
      ref={outerRef}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: 0, // shrink below content so clientWidth tracks the slot, not the row
        // Clip the natural-width measuring layer when squeezed. Must go visible
        // once collapsed so the absolutely-positioned dropdown isn't clipped.
        overflow: collapsed ? 'visible' : 'hidden',
      }}
    >
      {/* Always-mounted measuring layer: the real inline row at natural width
          (flex-shrink:0). Hidden but still laid out when collapsed, so the fit
          check keeps seeing the true natural width and can re-expand. */}
      <div
        ref={measureRef}
        style={{
          display: 'flex',
          flexShrink: 0,
          visibility: collapsed ? 'hidden' : undefined,
          pointerEvents: collapsed ? 'none' : undefined,
        }}
      >
        <PillRow
          items={items}
          value={value}
          onChange={onChange}
          testIdPrefix={testIdPrefix}
          disabledIds={disabledIds}
          disabledReason={disabledReason}
          measureOnly={collapsed}
        />
      </div>
      {collapsed && (
        <div
          ref={menuRootRef}
          // Absolutely positioned so it does NOT contribute to the outer box's
          // width — the hidden measuring layer is what defines (and lets us
          // measure) that. The header sits inside a `transform`ed ancestor,
          // which traps an absolute child's z-index in a local stacking context,
          // so lift this anchor while open to paint above page content.
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            zIndex: open ? 50 : undefined,
          }}
        >
          <button
            type="button"
            data-testid={`${testIdPrefix}collapsed`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${activeLabel} — open menu`}
            onClick={() => setOpen((o) => !o)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 11,
              whiteSpace: 'nowrap',
              color: 'var(--color-text)',
              background: 'var(--color-app-bg)',
              transition: 'background 140ms',
            }}
          >
            <span>{activeLabel}</span>
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
              ref={menuListRef}
              role="menu"
              aria-label="Navigate"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                zIndex: 50,
                minWidth: 168,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: 4,
                background: 'var(--color-card-bg)',
                border: '1px solid var(--color-card-border)',
                borderRadius: 12,
                boxShadow: 'var(--color-card-shadow)',
              }}
            >
              {items.map((t) => {
                const active = value === t.id;
                const disabled = isDisabledId(disabledIds, t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    data-testid={`${testIdPrefix}${t.id}`}
                    data-active={active}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                    title={disabled ? disabledReason : undefined}
                    onClick={() => {
                      if (disabled) return;
                      onChange(t.id);
                      setOpen(false);
                    }}
                    className="row-button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      textAlign: 'left',
                      color: disabled
                        ? 'color-mix(in oklab, var(--color-text-muted) 62%, transparent)'
                        : active
                          ? 'var(--color-primary-strong)'
                          : 'var(--color-text)',
                      cursor: disabled ? 'not-allowed' : undefined,
                      opacity: disabled ? 0.62 : undefined,
                    }}
                  >
                    {active && <Icon name="check" size={14} />}
                    <span style={active ? undefined : { paddingLeft: 22 }}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isDisabledId<T extends string>(
  disabledIds: ReadonlySet<T> | ReadonlyArray<T> | undefined,
  id: T,
): boolean {
  if (!disabledIds) return false;
  return isReadonlyArray(disabledIds) ? disabledIds.includes(id) : disabledIds.has(id);
}

function isReadonlyArray<T>(
  value: ReadonlySet<T> | ReadonlyArray<T>,
): value is ReadonlyArray<T> {
  return Array.isArray(value);
}
