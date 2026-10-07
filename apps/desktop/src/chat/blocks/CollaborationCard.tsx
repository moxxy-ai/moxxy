import { useState } from 'react';
import type { CollaborationBlock } from '@moxxy/chat-model';
import { ledState } from '@/collaborate/collab-view';
import { TraceEntry } from '../trace/TraceEntry';
import { DisclosureRow } from './DisclosureRow';

/**
 * Inline chat-transcript summary of a collaborative run. Compact by default;
 * expands to the roster + recent bus messages. The full, interactive view is
 * the dedicated **Collaborate** tab (header switcher) — this card is the
 * in-place record that a team ran in this turn.
 */
export function CollaborationCard({ block }: { readonly block: CollaborationBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const running = block.completedAtMs === null;
  const doneCount = block.agents.filter((a) => a.status === 'done').length;
  const state = running ? 'running' : block.conflicts.length > 0 ? 'awaiting' : 'done';

  return (
    <TraceEntry kind="subagent">
      <DisclosureRow
        state={state}
        label="Team"
        detail={`${block.agents.length} agent${block.agents.length === 1 ? '' : 's'}`}
        meta={
          <>
            {doneCount}/{block.agents.length} done · {block.messages.length} msg
            {block.control?.paused ? ' · paused' : ''}
          </>
        }
        live={running}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {block.fallbackReason && (
        <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-amber-text)', marginTop: 2 }}>
          {block.fallbackReason}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', fontSize: 'var(--type-row)' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {block.agents.map((a) => (
              <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
                <span className="led" data-state={ledState(a.status)} aria-hidden />
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span className="mono" style={{ fontSize: 'var(--type-label)', color: 'var(--color-text-dim)' }}>
                  {a.role} · {a.status}
                </span>
              </li>
            ))}
          </ul>
          {block.contracts.length > 0 && (
            <div className="mono" style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
              contracts: {block.contracts.map((c) => c.title).join(', ')}
            </div>
          )}
          {block.messages.slice(-4).map((m) => (
            <div key={m.id} style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>
              <span className="mono" style={{ color: 'var(--color-primary-strong)' }}>{m.from}</span>
              <span className="mono" style={{ color: 'var(--color-text-dim)' }}> &rarr; {m.to}</span>: {m.body}
            </div>
          ))}
          <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
            Open the Collaborate tab for the live team view, per-agent transcripts, and step-in controls.
          </div>
        </div>
      )}
    </TraceEntry>
  );
}
