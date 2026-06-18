import { useState } from 'react';
import type { CollaborationBlock } from '@moxxy/chat-model';
import { Icon } from '@moxxy/desktop-ui';

/** Status-dot color for one agent. */
function dotColor(status: string): string {
  if (status === 'done') return 'var(--color-green)';
  if (status === 'crashed' || status === 'killed') return 'var(--color-red)';
  if (status === 'working') return 'var(--color-primary)';
  return 'var(--color-text-dim)';
}

/**
 * Inline chat-transcript summary of a collaborative run. Compact by default;
 * expands to the roster + recent bus messages. The full, interactive view is
 * the dedicated **Collaborate** tab (header switcher) — this card is the
 * in-place record that a team ran in this turn.
 */
export function CollaborationCard({ block }: { readonly block: CollaborationBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const running = block.completedAtMs === null;
  const accent = running
    ? 'var(--color-primary)'
    : block.conflicts.length > 0
      ? 'var(--color-amber)'
      : 'var(--color-green)';
  const doneCount = block.agents.filter((a) => a.status === 'done').length;
  const statusText = running ? 'running' : block.conflicts.length > 0 ? 'done · conflicts' : 'done';

  return (
    <div style={{ alignSelf: 'stretch', display: 'flex', gap: 12, maxWidth: '92%' }}>
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 10,
          background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
          color: 'var(--color-primary-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="agent" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', width: '100%', textAlign: 'left' }}
        >
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>
            Team
            <span style={{ color: 'var(--color-text-dim)', fontWeight: 500, marginLeft: 6 }}>
              · {block.agents.length} agent{block.agents.length === 1 ? '' : 's'}
            </span>
          </span>
          <span className="mono" style={{ fontSize: 11, color: accent, fontWeight: 600 }}>
            {statusText}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
            · {doneCount}/{block.agents.length} done · {block.messages.length} msg
          </span>
          <span style={{ flex: 1 }} />
          {block.control?.paused && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-amber)', fontWeight: 600 }}>
              paused
            </span>
          )}
          {running && (
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: '50%', background: accent, animation: 'moxxy-thinking 1.1s ease-in-out infinite' }}
            />
          )}
          <span
            aria-hidden
            style={{ color: 'var(--color-text-dim)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease', display: 'inline-flex' }}
          >
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
        {block.fallbackReason && (
          <div style={{ fontSize: 11.5, color: 'var(--color-amber-text)', marginTop: 2 }}>
            {block.fallbackReason}
          </div>
        )}
        {open && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {block.agents.map((a) => (
                <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor(a.status), flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-dim)' }}>
                    {a.role} · {a.status}
                  </span>
                </li>
              ))}
            </ul>
            {block.contracts.length > 0 && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
                contracts: {block.contracts.map((c) => c.title).join(', ')}
              </div>
            )}
            {block.messages.slice(-4).map((m) => (
              <div key={m.id} style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                <span className="mono" style={{ color: 'var(--color-primary-strong)' }}>{m.from}</span>
                <span className="mono" style={{ color: 'var(--color-text-dim)' }}> → {m.to}</span>: {m.body}
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontStyle: 'italic' }}>
              Open the Collaborate tab for the live team view, per-agent transcripts, and step-in controls.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
