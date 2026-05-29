import { useState } from 'react';
import { useDesks } from '@/lib/useDesks';

interface DeskSidebarProps {
  /** Currently selected view tab — drives the highlighted entry in
   *  the lower nav. */
  readonly view: 'chat' | 'workflows' | 'settings';
  readonly onView: (v: 'chat' | 'workflows' | 'settings') => void;
}

/**
 * Left-rail with desks (workspaces) and a view switcher. Each desk
 * is a bound directory; clicking restarts the moxxy runner there.
 */
export function DeskSidebar({ view, onView }: DeskSidebarProps): JSX.Element {
  const desks = useDesks();
  const [busy, setBusy] = useState(false);

  const onNewDesk = async (): Promise<void> => {
    setBusy(true);
    try {
      const folder = await desks.pickFolder();
      if (!folder) return;
      const name = window.prompt(
        'Name this desk',
        folder.split('/').filter(Boolean).pop() ?? 'New desk',
      );
      if (!name?.trim()) return;
      const desk = await desks.create(name.trim());
      // Auto-activate the new desk for a clean handoff.
      if (desk) await desks.setActive(desk.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      style={{
        width: 240,
        background: 'var(--color-bg)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <Section title="Desks" hint={`${desks.desks.length}`}>
        <ul role="list" style={listStyle}>
          {desks.desks.map((d) => (
            <li
              key={d.id}
              data-testid={`desk-row-${d.id}`}
              data-active={desks.activeId === d.id}
              onClick={() => void desks.setActive(d.id)}
              style={{
                ...rowStyle,
                background:
                  desks.activeId === d.id
                    ? 'var(--color-bg-card-hover)'
                    : 'transparent',
                borderLeft:
                  desks.activeId === d.id
                    ? `2px solid ${d.color}`
                    : '2px solid transparent',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: d.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {d.name}
              </span>
              <button
                type="button"
                aria-label={`remove desk ${d.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Remove desk "${d.name}"?`)) {
                    void desks.remove(d.id);
                  }
                }}
                style={{
                  color: 'var(--color-text-dim)',
                  fontSize: '0.85rem',
                  padding: '0 0.25rem',
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          data-testid="desk-new"
          onClick={() => void onNewDesk()}
          disabled={busy}
          style={{
            margin: '0.4rem 0.75rem 0.75rem',
            padding: '0.4rem 0.6rem',
            fontSize: '0.8rem',
            color: 'var(--color-text-dim)',
            border: '1px dashed var(--color-border-light)',
            borderRadius: 'var(--radius-block)',
            textAlign: 'left',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Picking folder…' : '+ New desk'}
        </button>
      </Section>
      <Section title="View">
        <NavItem id="chat" current={view} onClick={onView} label="◇ Chat" />
        <NavItem
          id="workflows"
          current={view}
          onClick={onView}
          label="⏱ Workflows"
        />
        <NavItem
          id="settings"
          current={view}
          onClick={onView}
          label="⚙ Settings"
        />
      </Section>
      {desks.error && (
        <p
          role="alert"
          style={{
            margin: '0.5rem 0.75rem',
            padding: '0.4rem 0.5rem',
            fontSize: '0.75rem',
            color: 'var(--color-pink)',
            border: '1px solid var(--color-pink)',
            borderRadius: 'var(--radius-block)',
          }}
        >
          {desks.error}
        </p>
      )}
    </aside>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      style={{
        padding: '0.5rem 0 0.25rem',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '0.25rem 1rem',
          fontSize: '0.65rem',
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        {hint && <span style={{ opacity: 0.6 }}>{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function NavItem<T extends string>({
  id,
  current,
  onClick,
  label,
}: {
  readonly id: T;
  readonly current: T;
  readonly onClick: (next: T) => void;
  readonly label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={`nav-${id}`}
      data-active={current === id}
      onClick={() => onClick(id)}
      style={{
        padding: '0.4rem 0.75rem',
        textAlign: 'left',
        fontSize: '0.85rem',
        color: current === id ? 'var(--color-text)' : 'var(--color-text-muted)',
        borderLeft:
          current === id
            ? '2px solid var(--color-primary)'
            : '2px solid transparent',
        background:
          current === id ? 'var(--color-bg-card-hover)' : 'transparent',
      }}
    >
      {label}
    </button>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.4rem 1rem',
  cursor: 'pointer',
};
