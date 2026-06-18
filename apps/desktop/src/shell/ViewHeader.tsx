import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { PanelLeftIcon } from './PanelLeftIcon';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';

/** Top-level main-content views. Chat ↔ Workflows ↔ Collaborate ↔ Apps switch
 *  via the header's `ViewSwitcher`; Settings is reached from the sidebar. */
export type View = 'chat' | 'workflows' | 'collaborate' | 'settings' | 'apps';

/**
 * Shared section header — one 64px chrome bar so Chat / Workflows /
 * Settings all top out with the same height, border and padding.
 * Children lay out in a flex row; use `<span style={{ flex: 1 }} />`
 * to push trailing controls to the right edge.
 *
 * When the workspace sidebar is collapsed the rail (and its collapse
 * button) is gone entirely, so every header leads with the expand
 * affordance — it reads the shared collapsed store directly rather
 * than threading a prop through each view.
 */
export function ViewHeader({ children }: { readonly children: ReactNode }): JSX.Element {
  const sidebarCollapsed = useSidebarCollapsed();
  return (
    <header
      style={{
        height: 64,
        minHeight: 64,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: '0 24px',
        borderBottom: '1px solid var(--color-card-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {sidebarCollapsed && (
        <button
          type="button"
          aria-label="Expand sidebar"
          data-testid="sidebar-expand"
          title="Expand sidebar (⌘B / Ctrl+B)"
          onClick={() => setSidebarCollapsed(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 5,
            marginLeft: -6,
            borderRadius: 8,
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          <PanelLeftIcon size={16} />
        </button>
      )}
      {children}
    </header>
  );
}

/**
 * Segmented pill nav — the settings-tabs look (grey track, white active
 * pill), shared so the view switcher and the settings tabs read as one
 * control family. `value: null` renders with no active segment (used by
 * the switcher while Settings owns the pane).
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
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
  /** Fold into a dropdown when the inline row doesn't fit. Default off. */
  readonly collapsible?: boolean;
  /** Button label when collapsed and no tab is active (e.g. switcher on Settings). */
  readonly collapsedLabel?: string;
}): JSX.Element {
  if (!collapsible) {
    return (
      <PillRow items={items} value={value} onChange={onChange} testIdPrefix={testIdPrefix} />
    );
  }

  return (
    <CollapsibleSegmented
      items={items}
      value={value}
      onChange={onChange}
      testIdPrefix={testIdPrefix}
      collapsedLabel={collapsedLabel}
    />
  );
}

/** The inline grey-track / white-pill row — the un-collapsed look. `navRef`
 *  lets the responsive wrapper read its natural width. */
function PillRow<T extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
  navRef,
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
  readonly navRef?: React.Ref<HTMLElement>;
}): JSX.Element {
  return (
    <nav
      ref={navRef}
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
        return (
          <button
            key={t.id}
            type="button"
            data-testid={`${testIdPrefix}${t.id}`}
            data-active={active}
            onClick={() => onChange(t.id)}
            style={pillStyle(active)}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 15px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 9,
    whiteSpace: 'nowrap',
    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
    background: active ? 'var(--color-surface)' : 'transparent',
    boxShadow: active ? '0 1px 3px rgba(15, 23, 42, 0.12)' : 'none',
    transition: 'background 140ms, color 140ms',
  };
}

/**
 * The responsive shell around an inline Segmented row.
 *
 * Fit detection without a duplicate DOM subtree: the live inline row is
 * always rendered first; while it's shown we snapshot its NATURAL width
 * (`scrollWidth`) into a ref. A ResizeObserver on the outer (shrinkable)
 * container then compares that remembered natural width against the available
 * width and flips `collapsed`. Snapshotting the width (rather than re-reading
 * the live row, which shrinks once collapsed) breaks the classic flip-flop
 * loop — the decision input never changes just because we collapsed. When the
 * container later grows back past the natural width we expand and re-snapshot.
 *
 * In a DOM without ResizeObserver (the real renderer's jsdom unit env) it
 * stays expanded — the wide-window default — so the inline tabs render exactly
 * as before and existing tab-by-text/-testid tests keep passing.
 */
function CollapsibleSegmented<T extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
  collapsedLabel,
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
  readonly collapsedLabel: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  // Last natural (un-squeezed) width of the inline row, captured while it was
  // displayed. Survives the collapse so the fit decision stays stable.
  const naturalWidthRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);

  // Re-evaluate fit on container/window resize and whenever the items change.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') return; // jsdom — stay expanded.

    const evaluate = (): void => {
      // Refresh the remembered natural width whenever the live row is shown.
      const nav = navRef.current;
      if (nav) naturalWidthRef.current = nav.scrollWidth;
      const natural = naturalWidthRef.current;
      const available = container.clientWidth;
      // No layout yet (0 widths) → don't collapse. +1 slack absorbs sub-pixel
      // rounding so we don't collapse on an exact fit.
      if (natural <= 0 || available <= 0) {
        setCollapsed(false);
        return;
      }
      setCollapsed(natural > available + 1);
    };

    evaluate();
    const ro = new ResizeObserver(evaluate);
    ro.observe(container);
    return () => ro.disconnect();
  }, [items, value]);

  // When folded shut, dismiss on outside-click / Escape — matching RailMenu /
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

  const activeLabel = items.find((t) => t.id === value)?.label ?? collapsedLabel;

  return (
    <div
      ref={containerRef}
      style={{
        minWidth: 0, // allow the flex item to shrink so width tracks the squeeze
        display: 'flex',
        alignItems: 'center',
        // While expanded, clip the inline row to its squeezed box so it can't
        // spill past the header in the one frame before the observer collapses
        // it. When collapsed, overflow MUST stay visible — the dropdown is
        // absolutely positioned below this box.
        overflow: collapsed ? 'visible' : 'hidden',
      }}
    >
      {collapsed ? (
        <div
          ref={menuRootRef}
          // The header pane sits inside a `transform`ed ancestor, which traps
          // an absolutely-positioned child's z-index in a local stacking
          // context. Lift this anchor while open so the dropdown paints ABOVE
          // the page content instead of being covered. (See the same note on
          // the workspace RowMenu.)
          style={{
            position: 'relative',
            display: 'inline-flex',
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
              padding: '7px 12px',
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
                boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.45)',
              }}
            >
              {items.map((t) => {
                const active = value === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    data-testid={`${testIdPrefix}${t.id}`}
                    data-active={active}
                    onClick={() => {
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
                      color: active ? 'var(--color-primary-strong)' : 'var(--color-text)',
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
      ) : (
        <PillRow
          items={items}
          value={value}
          onChange={onChange}
          testIdPrefix={testIdPrefix}
          navRef={navRef}
        />
      )}
    </div>
  );
}

const SWITCH_ITEMS: ReadonlyArray<{
  readonly id: 'chat' | 'workflows' | 'collaborate' | 'apps';
  readonly label: string;
}> = [
  { id: 'chat', label: 'Chat' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'collaborate', label: 'Collaborate' },
  { id: 'apps', label: 'Apps' },
];

/** Chat ↔ Workflows ↔ Apps segmented switcher — the leading element of every
 *  unified header, standing in for a per-view title. */
export function ViewSwitcher({
  view,
  onView,
}: {
  readonly view: View;
  readonly onView: (v: View) => void;
}): JSX.Element {
  return (
    <Segmented
      items={SWITCH_ITEMS}
      value={view === 'settings' ? null : view}
      onChange={onView}
      testIdPrefix="nav-"
      collapsible
      // On the Settings view this switcher has no active segment; label the
      // folded button with the view family rather than a blank.
      collapsedLabel="Views"
    />
  );
}
