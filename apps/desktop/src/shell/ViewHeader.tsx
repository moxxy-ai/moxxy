import type { ReactNode } from 'react';

/** Top-level main-content views. Chat ↔ Workflows switch via the header's
 *  `ViewSwitcher`; Settings is reached from the sidebar. */
export type View = 'chat' | 'workflows' | 'settings';

/**
 * Shared section header — one 64px chrome bar so Chat / Workflows /
 * Settings all top out with the same height, border and padding.
 * Children lay out in a flex row; use `<span style={{ flex: 1 }} />`
 * to push trailing controls to the right edge.
 */
export function ViewHeader({ children }: { readonly children: ReactNode }): JSX.Element {
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
      {children}
    </header>
  );
}

/**
 * Segmented pill nav — the settings-tabs look (grey track, white active
 * pill), shared so the view switcher and the settings tabs read as one
 * control family. `value: null` renders with no active segment (used by
 * the switcher while Settings owns the pane).
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
}: {
  readonly items: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly onChange: (id: T) => void;
  readonly testIdPrefix: string;
}): JSX.Element {
  return (
    <nav
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        background: '#f1f2f9',
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
            style={{
              padding: '6px 15px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 9,
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              background: active ? '#fff' : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(15, 23, 42, 0.12)' : 'none',
              transition: 'background 140ms, color 140ms',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

const SWITCH_ITEMS: ReadonlyArray<{ readonly id: 'chat' | 'workflows'; readonly label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'workflows', label: 'Workflows' },
];

/** Chat ↔ Workflows segmented switcher — the leading element of every
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
    />
  );
}
