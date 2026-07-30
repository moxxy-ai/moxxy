import { useState } from 'react';
import { oneLine, summarizeArgs, type SubagentBlock } from '@moxxy/chat-model';
import { Icon } from '@moxxy/desktop-ui';
import { preStyle } from './block-shared';
import { TraceEntry } from '../trace/TraceEntry';

export function SubagentView({
  block,
}: {
  readonly block: SubagentBlock;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const running = block.completedAtMs === null && block.error === null;
  const state = block.error ? 'failed' : running ? 'running' : 'done';
  return (
    <TraceEntry
      kind="subagent"
      testId="block-subagent"
      meta={`${block.toolCallCount} tool ${block.toolCallCount === 1 ? 'call' : 'calls'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-6)',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span className="led" data-state={state} aria-hidden />
        <span className={running ? 'activity-shimmer' : undefined} style={{ fontWeight: 600, fontSize: 'var(--type-row)' }}>
          {block.label}
        </span>
        <span style={{ flex: 1 }} />
        <span
          aria-hidden
          style={{
            color: 'var(--color-text-dim)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform var(--motion-shift) ease',
            display: 'inline-flex',
          }}
        >
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {open && <SubagentDetail block={block} />}
    </TraceEntry>
  );
}

/**
 * The expanded detail body for one subagent — its tool-call list + final
 * preview (or error). Shared so SubagentGroupView's per-agent rows show the
 * exact same "expand to see tool calls + final output" view as a standalone
 * SubagentView.
 */
export function SubagentDetail({ block }: { readonly block: SubagentBlock }): JSX.Element {
  const running = block.completedAtMs === null && block.error === null;
  const elapsed =
    block.completedAtMs !== null ? Math.round((block.completedAtMs - block.startedAtMs) / 100) / 10 : null;
  return (
    <div
      style={{
        marginTop: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        fontSize: 'var(--type-row)',
        color: 'var(--color-text-muted)',
      }}
    >
      <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
        {block.toolCallCount} tool {block.toolCallCount === 1 ? 'call' : 'calls'}
        {block.stopReason ? ` · ${block.stopReason}` : ''}
        {elapsed !== null ? ` · ${elapsed}s` : ''}
      </div>
      {/* The same activity rows a step's tools get in the main trace. These used
          to carry a violet wash, which spent a hue the palette reserves for
          meaning on saying only "this happened inside an agent" — something the
          gutter glyph already says. */}
      {block.toolCalls.length > 0 && (
        <ul className="activity-list" role="list">
          {block.toolCalls.map((tc, i) => {
            const sum = oneLine(summarizeArgs(tc.input));
            return (
              <li key={i} className="activity-list__item">
                <span className="activity-detail-row">
                  <span className="activity-detail-row__name">{tc.name}</span>
                  {sum && <span className="activity-detail-row__label">{sum}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {block.error ? (
        <pre style={{ ...preStyle, color: 'var(--color-red-text)' }}>{block.error}</pre>
      ) : block.finalPreview ? (
        <pre style={preStyle}>{block.finalPreview}</pre>
      ) : (
        <div style={{ color: 'var(--color-text-dim)' }}>
          {running ? 'Working…' : 'No output captured.'}
        </div>
      )}
    </div>
  );
}
