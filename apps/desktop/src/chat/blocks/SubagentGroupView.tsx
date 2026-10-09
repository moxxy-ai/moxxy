import { useState } from 'react';
import { formatTokensK, type SubagentBlock, type SubagentGroupBlock } from '@moxxy/chat-model';
import { DisclosureRow } from './DisclosureRow';
import { SubagentDetail } from './SubagentView';
import { TraceEntry } from '../trace/TraceEntry';
import { useAgentTitle } from '../modes/ModeTranscriptContext';

/**
 * A fan-out of sibling subagents folded into one line: "4 Explore agents
 * finished". Opened, it lists each agent as a row with its state, and each row
 * opens in turn to that agent's tool calls and answer (shared SubagentDetail).
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
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </TraceEntry>
  );
}

/** One agent of the fan-out: what it is doing, how much it has done, and how it
 *  stands. It opens to the agent's tool calls and its answer. */
function AgentRow({ agent }: { readonly agent: SubagentBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const title = useAgentTitle(agent.childSessionId) ?? agent.label;
  const running = isRunning(agent);
  const state = agent.error ? 'failed' : running ? 'running' : 'done';
  const tokens = formatTokensK(agent.tokensUsed);
  return (
    <div className="agent-row">
      <button type="button" className="agent-row__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="led" data-state={state} aria-hidden />
        <span className="agent-row__name">{title}</span>
        <span className="agent-row__meta">
          {agent.toolCallCount} tool {agent.toolCallCount === 1 ? 'use' : 'uses'}
          {tokens ? ` · ${tokens} tokens` : ''}
        </span>
        <span className="agent-row__state" data-tone={state}>
          {STATE_WORD[state]}
        </span>
      </button>
      {agent.error && <p className="agent-row__error">{agent.error}</p>}
      {open && <SubagentDetail block={agent} />}
    </div>
  );
}

const STATE_WORD = { running: 'Running', done: 'Done', failed: 'Failed' } as const;

function isRunning(a: SubagentBlock): boolean {
  return a.completedAtMs === null && a.error === null;
}

/** "4 Explore agents finished" / "3 agents running" / "3 agents finished, 1
 *  failed". The default kind has no name worth saying, and a mixed batch has
 *  none to say. */
function headerLabel(block: SubagentGroupBlock, running: number, failed: number): string {
  const n = block.agents.length;
  const named = block.agentType !== 'mixed' && block.agentType !== 'default';
  const typeWord = named ? `${block.agentType} ` : '';
  const noun = n === 1 ? 'agent' : 'agents';
  const verb = running > 0 ? 'running' : 'finished';
  const failSuffix = failed > 0 ? `, ${failed} failed` : '';
  return `${n} ${typeWord}${noun} ${verb}${failSuffix}`;
}

/** The batch's one state: any failure outranks any still running, which outranks
 *  the whole fan-out having landed. */
function ledState(running: number, failed: number): 'failed' | 'running' | 'done' {
  if (failed > 0) return 'failed';
  return running > 0 ? 'running' : 'done';
}
