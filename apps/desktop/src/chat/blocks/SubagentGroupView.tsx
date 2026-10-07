import { useState } from 'react';
import { formatTokensK, type SubagentBlock, type SubagentGroupBlock } from '@moxxy/chat-model';
import { DisclosureRow } from './DisclosureRow';
import { SubagentDetail } from './SubagentView';
import { TraceEntry } from '../trace/TraceEntry';

/**
 * A fan-out of sibling subagents folded into one compact collapsible tree:
 *
 *   ● 4 Explore agents finished
 *     ├ Find file-writing tools · 45 tool uses · 65.3k tokens
 *     │  └ Done
 *     ├ Understand TUI rendering · 43 tool uses · 66.3k tokens
 *     │  └ Done
 *
 * Collapsed by default — one header row summarising the batch. Expanding
 * lists each agent as a tree row; each row is itself secondarily expandable
 * to reveal that agent's tool calls + final output (shared SubagentDetail).
 */
export function SubagentGroupView({
  block,
}: {
  readonly block: SubagentGroupBlock;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  const running = block.agents.filter(isRunning).length;
  const failed = block.agents.filter((a) => a.error !== null).length;

  return (
    <TraceEntry kind="subagent" testId="block-subagent-group">
      <DisclosureRow
        state={ledState(running, failed)}
        label={headerLabel(block, running, failed)}
        live={running > 0}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="disclosure-body disclosure-body--tight">
          {block.agents.map((agent) => (
            <AgentTreeRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </TraceEntry>
  );
}

/** One agent as a tree row + status sub-line, secondarily expandable to its
 *  tool-call / final-output detail. */
function AgentTreeRow({ agent }: { readonly agent: SubagentBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const running = isRunning(agent);
  const tokens = formatTokensK(agent.tokensUsed);
  const statusText = running ? 'running' : agent.error ? 'failed' : 'Done';
  const statusColor = agent.error
    ? 'var(--color-red)'
    : running
      ? 'var(--color-primary)'
      : 'var(--color-text-muted)';
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mono"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          padding: '1px 0',
          width: '100%',
          textAlign: 'left',
          fontSize: 'var(--type-meta)',
        }}
      >
        <span aria-hidden style={{ color: 'var(--color-text-dim)', flexShrink: 0 }}>
          ├
        </span>
        <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agent.label}
        </span>
        <span style={{ color: 'var(--color-text-dim)', flexShrink: 0 }}>
          · {agent.toolCallCount} tool {agent.toolCallCount === 1 ? 'use' : 'uses'}
          {tokens ? ` · ${tokens} tokens` : ''}
        </span>
      </button>
      <div
        className="mono"
        style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--type-meta)', paddingLeft: 0 }}
      >
        <span aria-hidden style={{ color: 'var(--color-text-dim)', flexShrink: 0 }}>
          {'  │  └'}
        </span>
        <span style={{ color: statusColor }}>
          {statusText}
          {agent.error ? ` — ${agent.error}` : ''}
        </span>
      </div>
      {open && (
        <div style={{ paddingLeft: 16 }}>
          <SubagentDetail block={agent} />
        </div>
      )}
    </div>
  );
}

function isRunning(a: SubagentBlock): boolean {
  return a.completedAtMs === null && a.error === null;
}

/** "4 Explore agents finished" / "1 Explore agent finished" / "3 agents
 *  finished" (mixed) — plus a "running" / "(M failed)" suffix when in flight
 *  or any member errored. */
function headerLabel(block: SubagentGroupBlock, running: number, failed: number): string {
  const n = block.agents.length;
  const typeWord = block.agentType === 'mixed' ? '' : `${block.agentType} `;
  const noun = n === 1 ? 'agent' : 'agents';
  const verb = running > 0 ? 'running' : 'finished';
  const failSuffix = failed > 0 ? ` (${failed} failed)` : '';
  return `${n} ${typeWord}${noun} ${verb}${failSuffix}`;
}

/** The batch's one state: any failure outranks any still running, which outranks
 *  the whole fan-out having landed. */
function ledState(running: number, failed: number): 'failed' | 'running' | 'done' {
  if (failed > 0) return 'failed';
  return running > 0 ? 'running' : 'done';
}
