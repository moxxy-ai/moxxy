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
import { InstrumentBar } from '../shell/InstrumentBar';

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
      <InstrumentBar crumbs={['Automations', 'Webhooks']}>
        <button
          type="button"
          className="btn-box tip"
          data-tip="Refresh"
          data-tip-side="bottom"
          aria-label="Refresh webhooks"
          onClick={() => void hooks.refresh()}
        >
          <Icon name="rotate" size={14} />
        </button>
      </InstrumentBar>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 'var(--space-20) var(--space-32)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-16)',
        }}
      >
        {hooks.error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 'var(--space-6) var(--space-8)',
              border: '1px solid var(--color-red-border)',
              background: 'var(--color-red-wash)',
              borderRadius: 'var(--radius-block)',
              fontSize: 'var(--type-row)',
            }}
          >
            {hooks.error}
          </p>
        )}
        {hooks.loading && hooks.list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        ) : hooks.list.length === 0 ? (
          <p style={{ color: 'var(--color-text-dim)' }}>
            No webhooks on this runner. Ask the agent to create an inbound webhook trigger from
            chat (the <strong>webhook</strong> tools).
          </p>
        ) : (
          <div className="data-table data-table--hooks" role="table" aria-label="Webhooks">
            <div className="data-row data-row--head" role="row">
              <span />
              <span role="columnheader">webhook</span>
              <span role="columnheader">endpoint</span>
              <span role="columnheader">runs in</span>
              <span role="columnheader">state</span>
            </div>
            {hooks.list.map((w) => (
              <div
                key={w.id}
                className="data-row"
                role="row"
                data-testid={`webhook-row-${w.id}`}
              >
                <span className="led" data-state={w.enabled ? 'done' : undefined} aria-hidden />
                <span className="data-row__name" role="cell">
                  {w.name}
                  {w.description && <small>{w.description}</small>}
                </span>
                {/* The public URL when a tunnel is up, else the always-present local
                    path — the row must never imply an endpoint that is not reachable. */}
                <span className="data-row__meta" role="cell" title={w.url ?? w.localPath}>
                  {w.url ?? w.localPath}
                  {!w.url && <small> · local only</small>}
                </span>
                <span role="cell">
                  <TargetSessionPicker
                    value={w.targetSessionId ?? null}
                    valueName={w.targetSessionName ?? null}
                    onChange={(sid) => void hooks.setTargetSession(w.id, sid)}
                  />
                </span>
                <span role="cell">
                  <button
                    type="button"
                    className="tag"
                    aria-pressed={w.enabled}
                    aria-label={`${w.enabled ? 'Disable' : 'Enable'} ${w.name}`}
                    onClick={() => void hooks.setEnabled(w.id, !w.enabled)}
                    style={
                      w.enabled
                        ? { color: 'var(--color-green)', borderColor: 'var(--color-green)' }
                        : undefined
                    }
                  >
                    {w.enabled ? 'on' : 'paused'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
