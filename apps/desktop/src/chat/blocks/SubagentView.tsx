import { useState } from 'react';
import { oneLine, subagentState, subagentToolsLabel, summarizeArgs, type SubagentBlock } from '@moxxy/chat-model';
import { preStyle } from './block-shared';
import { DisclosureRow } from './DisclosureRow';
import { TraceEntry } from '../trace/TraceEntry';

export function SubagentView({
  block,
}: {
  readonly block: SubagentBlock;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const state = subagentState(block);
  return (
    <TraceEntry kind="subagent" testId="block-subagent">
      <DisclosureRow
        state={state}
        label={block.label}
        {...(state === 'background' ? { detail: 'in the background' } : subagentNote(block) ? { detail: subagentNote(block) } : {})}
        meta={subagentToolsLabel(block, 'call') ?? ''}
        live={state === 'running'}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
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
  const state = subagentState(block);
  const elapsed =
    block.completedAtMs !== null ? Math.round((block.completedAtMs - block.startedAtMs) / 100) / 10 : null;
  return (
    <div className="disclosure-body">
      <div className="disclosure-body__meta">
        {[subagentToolsLabel(block, 'call'), block.stopReason || null, elapsed !== null ? `${elapsed}s` : null].filter(Boolean).join(' · ')}
      </div>
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
        <div className="disclosure-body__meta">
          {state === 'running' ? 'Working…' : state === 'background' ? 'Went on in the background.' : 'No output captured.'}
        </div>
      )}
    </div>
  );
}

/** Marks the row of a helper reporting back from the background, after the turn that started it. */
export function subagentNote(block: SubagentBlock): string | null {
  return block.continued === true ? 'from the background' : null;
}
