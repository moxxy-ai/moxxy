import { useState } from 'react';
import { formatTokensK, type SubagentBlock, type SubagentGroupBlock } from '@moxxy/chat-model';
import { Icon } from '@moxxy/desktop-ui';
import { SubagentDetail, SUBAGENT_TILE_FG } from './SubagentView';

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
  const accent = failed > 0 ? 'var(--color-red)' : running > 0 ? 'var(--color-primary)' : 'var(--color-green)';

  return (
    <div
      data-testid="block-subagent-group"
      style={{ alignSelf: 'stretch', display: 'flex', gap: 12, maxWidth: '92%' }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 10,
          background: 'color-mix(in srgb, var(--color-purple) 14%, transparent)',
          color: SUBAGENT_TILE_FG,
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
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '2px 0',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              flexShrink: 0,
              borderRadius: '50%',
              background: accent,
              ...(running > 0 ? { animation: 'moxxy-thinking 1.1s ease-in-out infinite' } : {}),
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{headerLabel(block, running, failed)}</span>
          <span style={{ flex: 1 }} />
          <span
            aria-hidden
            style={{
              color: 'var(--color-text-dim)',
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 120ms ease',
              display: 'inline-flex',
            }}
          >
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
        {open && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {block.agents.map((agent) => (
              <AgentTreeRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
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
          fontSize: 11.5,
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
        style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5, paddingLeft: 0 }}
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
