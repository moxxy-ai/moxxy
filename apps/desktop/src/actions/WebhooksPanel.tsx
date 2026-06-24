/**
 * Webhooks sub-view of the Actions surface. Lists the workflows that fire on a
 * webhook delivery (an `on.webhook` trigger), with enable/disable. Content-only
 * — the Actions header is owned by {@link ActionsPanel}.
 *
 * Stage 1 surfaces webhook-TRIGGERED workflows from `workflows.list`; the
 * endpoint URLs + per-webhook delivery history need a dedicated webhooks backend
 * (no IPC yet) and land in a follow-up.
 */

import { useWorkflows } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';

export function WebhooksPanel(): JSX.Element {
  const wf = useWorkflows();
  const hooks = wf.list.filter((w) => w.triggers.toLowerCase().includes('webhook'));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px 0' }}>
        <Button variant="chip" onClick={() => void wf.refresh()} style={{ borderRadius: 9 }}>
          <Icon name="rotate" size={14} />
          Refresh
        </Button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '1.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {wf.error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '0.45rem 0.65rem',
              border: '1px solid var(--color-pink)',
              background: 'color-mix(in oklab, var(--color-pink) 12%, transparent)',
              borderRadius: 'var(--radius-block)',
              fontSize: '0.85rem',
            }}
          >
            {wf.error}
          </p>
        )}
        {wf.loading && wf.list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        ) : hooks.length === 0 ? (
          <p style={{ color: 'var(--color-text-dim)' }}>
            No webhook-triggered workflows. Give a workflow an <code>on.webhook</code> trigger to fire
            it from an incoming delivery.
          </p>
        ) : (
          <ul
            role="list"
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            {hooks.map((w) => (
              <li
                key={w.name}
                data-testid={`webhook-row-${w.name}`}
                style={{
                  padding: '0.65rem 0.85rem',
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-block)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '0.5rem',
                  alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{w.name}</div>
                  <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>
                    {w.triggers}
                  </div>
                </div>
                <Button
                  variant="chip"
                  onClick={() => void wf.setEnabled(w.name, !w.enabled)}
                  style={{ borderRadius: 9 }}
                >
                  {w.enabled ? 'Disable' : 'Enable'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
