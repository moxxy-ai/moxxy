/**
 * Webhooks sub-view of the Apps surface. Lists the runner's inbound webhook
 * triggers from `webhooks.list` (read straight from the shared webhooks store,
 * so triggers created from chat via the `webhook_*` tools show up), with their
 * delivery path, fire count + last result, and enable/disable + delete.
 * Content-only — the Apps header (top switcher + sub-tabs) is owned by
 * {@link AppsPanel}. Verification secrets are redacted host-side before the
 * summary ever reaches here.
 */

import { useWebhooks } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';
import type { WebhookSummary } from '@moxxy/desktop-ipc-contract';
import { TargetSessionPicker } from './TargetSessionPicker';

/** One-line activity summary: fires + last fire time + model override. */
function activityLabel(w: WebhookSummary): string {
  const parts: string[] = [`${w.fireCount} ${w.fireCount === 1 ? 'fire' : 'fires'}`];
  if (w.lastFiredAt) parts.push(`last ${new Date(w.lastFiredAt).toLocaleString()}`);
  if (w.lastResult) parts.push(`result: ${w.lastResult}`);
  if (w.model) parts.push(w.model);
  return parts.join(' · ');
}

export function WebhooksPanel(): JSX.Element {
  const hooks = useWebhooks();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px 0' }}>
        <Button variant="chip" onClick={() => void hooks.refresh()} style={{ borderRadius: 9 }}>
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
        {hooks.error && (
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
            {hooks.error}
          </p>
        )}
        {hooks.loading && hooks.list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        ) : hooks.list.length === 0 ? (
          <p style={{ color: 'var(--color-text-dim)' }}>
            No webhooks on this runner. Ask the agent to create an inbound webhook trigger from
            chat (the <strong>webhook</strong> tools).
          </p>
        ) : (
          <ul
            role="list"
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            {hooks.list.map((w) => (
              <li
                key={w.id}
                data-testid={`webhook-row-${w.id}`}
                style={{
                  padding: '0.65rem 0.85rem',
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-block)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: '0.5rem',
                  alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{w.name}</div>
                  <div
                    className="mono"
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--color-text-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={w.url ?? w.localPath}
                  >
                    {w.url ?? w.localPath} · {activityLabel(w)}
                  </div>
                  {w.description && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {w.description}
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <TargetSessionPicker
                      label="Delivers to"
                      value={w.targetSessionId ?? null}
                      valueName={w.targetSessionName ?? null}
                      onChange={(sid) => void hooks.setTargetSession(w.id, sid)}
                    />
                  </div>
                </div>
                <Button
                  variant="chip"
                  onClick={() => void hooks.setEnabled(w.id, !w.enabled)}
                  style={{ borderRadius: 9 }}
                >
                  {w.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  variant="chip"
                  data-testid={`webhook-delete-${w.id}`}
                  onClick={() => void hooks.deleteWebhook(w.id)}
                  style={{ borderRadius: 9 }}
                >
                  <Icon name="x" size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
