import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { SURFACE_PANES, type RailPane } from '../../shell/surfaces/registry';

/**
 * The repurposed context button: instead of toggling the rail, it opens a
 * dropdown to pick what the rail shows — Open a terminal, Files changed (only
 * in a git repo), Files (browse + preview the whole workspace), or Browser.
 * Picking a pane opens the rail to it.
 */
export function RailMenu({
  workspaceId,
  current,
  onPick,
}: {
  readonly workspaceId: string | null;
  readonly current: RailPane | null;
  readonly onPick: (pane: RailPane) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [isRepo, setIsRepo] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Probe git only when the menu opens, so "Files changed" appears exactly when
  // the workspace is a repo. Cheap + avoids a poll.
  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    void api()
      .invoke('git.isRepo', { workspaceId })
      .then((r) => {
        if (!cancelled) setIsRepo(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  // Driven by the surface registry: every `menu` pane appears here (plugin
  // panes that opt into the menu show up automatically). `needsRepo` panes are
  // gated on the git probe above.
  const items = SURFACE_PANES.filter((p) => p.menu).map((p) => ({
    pane: p.kind,
    icon: p.icon,
    label: p.title,
    show: p.needsRepo ? isRepo : true,
  }));

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="btn-icon"
        aria-label="Open context menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          color: current ? 'var(--color-primary-strong)' : 'var(--color-text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="context" size={18} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 40,
            minWidth: 200,
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
          {items
            .filter((it) => it.show)
            .map((it) => (
              <button
                key={it.pane}
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(it.pane);
                  setOpen(false);
                }}
                className="row-button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  fontSize: 13,
                  color: current === it.pane ? 'var(--color-primary-strong)' : 'var(--color-text)',
                  fontWeight: current === it.pane ? 600 : 500,
                  textAlign: 'left',
                }}
              >
                <Icon name={it.icon} size={15} />
                {it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
