import { useState } from 'react';
import { useDesks } from '@/lib/useDesks';
import { Skeleton } from '@/lib/Skeleton';

export type View = 'chat' | 'workflows' | 'settings';

interface Props {
  readonly view: View;
  readonly onView: (v: View) => void;
}

const MENU_ITEMS: ReadonlyArray<{ id: View; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: '◇' },
  { id: 'workflows', label: 'Workflows', icon: '⏱' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

/**
 * Dark left rail. Top: WORKSPACES (each desk = workspace). Middle:
 * MENU (Chat / Workflows / Settings). Bottom: user-profile pill that
 * doubles as a presence indicator.
 *
 * Density mirrors the reference shot — wide-enough rows (`44px`) to
 * read like nav, not a context menu.
 */
export function WorkspaceSidebar({ view, onView }: Props): JSX.Element {
  const desks = useDesks();
  const [busy, setBusy] = useState(false);

  const onNewWorkspace = async (): Promise<void> => {
    setBusy(true);
    try {
      const folder = await desks.pickFolder();
      if (!folder) return;
      const name = window.prompt(
        'Name this workspace',
        folder.split('/').filter(Boolean).pop() ?? 'New workspace',
      );
      if (!name?.trim()) return;
      const desk = await desks.create(name.trim());
      if (desk) await desks.setActive(desk.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="col-sidebar">
      <Logo />
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px' }}>
        <SectionHeader title="Workspaces" />
        {desks.loading && desks.desks.length === 0 && (
          <div style={{ padding: '8px 0' }}>
            <Skeleton.Row />
            <Skeleton.Row />
          </div>
        )}
        <ul role="list" style={listReset}>
          {desks.desks.map((d) => (
            <WorkspaceRow
              key={d.id}
              desk={d}
              active={desks.activeId === d.id}
              onClick={() => void desks.setActive(d.id)}
              onRemove={() => {
                if (window.confirm(`Remove workspace "${d.name}"?`)) {
                  void desks.remove(d.id);
                }
              }}
            />
          ))}
        </ul>
        <button
          type="button"
          data-testid="desk-new"
          onClick={() => void onNewWorkspace()}
          disabled={busy}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '10px 12px',
            marginTop: 6,
            fontSize: 13,
            color: 'var(--color-sidebar-text-dim)',
            borderRadius: 10,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Picking folder…' : '＋  New workspace'}
        </button>

        <SectionHeader title="Menu" style={{ marginTop: 20 }} />
        <ul role="list" style={listReset}>
          {MENU_ITEMS.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                data-testid={`nav-${m.id}`}
                data-active={view === m.id}
                onClick={() => onView(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 13.5,
                  color:
                    view === m.id
                      ? 'var(--color-sidebar-text)'
                      : 'var(--color-sidebar-text-dim)',
                  background:
                    view === m.id ? 'var(--color-sidebar-bg-active)' : 'transparent',
                  borderRadius: 10,
                  fontWeight: view === m.id ? 600 : 500,
                }}
              >
                <span aria-hidden style={{ width: 18, textAlign: 'center', opacity: 0.85 }}>
                  {m.icon}
                </span>
                <span>{m.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ProfilePill />
    </aside>
  );
}

function Logo(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '18px 18px 14px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #6366f1, #818cf8)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        m
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
        moxxy
      </span>
    </div>
  );
}

function SectionHeader({
  title,
  style,
}: {
  readonly title: string;
  readonly style?: React.CSSProperties;
}): JSX.Element {
  return (
    <div
      style={{
        padding: '8px 12px 6px',
        fontSize: 10.5,
        fontWeight: 600,
        color: 'var(--color-sidebar-text-dim)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        ...style,
      }}
    >
      {title}
    </div>
  );
}

function WorkspaceRow({
  desk,
  active,
  onClick,
  onRemove,
}: {
  readonly desk: { id: string; name: string; color: string };
  readonly active: boolean;
  readonly onClick: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  return (
    <li>
      <div
        data-testid={`desk-row-${desk.id}`}
        data-active={active}
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          borderRadius: 10,
          cursor: 'pointer',
          background: active ? 'var(--color-sidebar-bg-active)' : 'transparent',
          color: active ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
          fontWeight: active ? 600 : 500,
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = 'var(--color-sidebar-bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `${desk.color}1f`,
            color: desk.color,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {desk.name.slice(0, 1).toUpperCase()}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 13.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {desk.name}
        </span>
        <button
          type="button"
          aria-label={`remove workspace ${desk.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            color: 'var(--color-sidebar-text-dim)',
            opacity: active ? 1 : 0.55,
            padding: '0 4px',
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>
    </li>
  );
}

function ProfilePill(): JSX.Element {
  return (
    <div
      style={{
        margin: 12,
        padding: '10px 12px',
        background: 'var(--color-sidebar-bg-active)',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #f59e0b, #f472b6)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        ●
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--color-sidebar-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          You
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--color-sidebar-text-dim)' }}>
          Connected
        </div>
      </div>
    </div>
  );
}

const listReset: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
