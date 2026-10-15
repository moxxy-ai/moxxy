import { useState } from 'react';
import { formatTokensK, subagentGroupHeader, subagentState, subagentToolsLabel, type SubagentBlock, type SubagentGroupBlock } from '@moxxy/chat-model';
import { DisclosureRow } from './DisclosureRow';
import { SubagentDetail, subagentNote } from './SubagentView';
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

  const running = block.agents.filter((a) => subagentState(a) === 'running').length;
  const background = block.agents.filter((a) => subagentState(a) === 'background').length;
  const failed = block.agents.filter((a) => a.error !== null).length;

  return (
    <TraceEntry kind="subagent" testId="block-subagent-group">
      <DisclosureRow
        state={ledState(running, background, failed)}
        label={subagentGroupHeader(block)}
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
  const state = subagentState(agent);
  const note = subagentNote(agent);
  const tokens = formatTokensK(agent.tokensUsed);
  return (
    <div className="agent-row">
      <button type="button" className="agent-row__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="led" data-state={state} aria-hidden />
        <span className="agent-row__name">{title}</span>
        {note && <span className="agent-row__note">{note}</span>}
        <span className="agent-row__meta">
          {[subagentToolsLabel(agent, 'use'), tokens ? `${tokens} tokens` : null].filter(Boolean).join(' · ')}
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

const STATE_WORD = { running: 'Running', background: 'In the background', done: 'Done', failed: 'Failed' } as const;

/** The batch's one state: any failure outranks any still running, which outranks
 *  any going on in the background, which outranks the whole fan-out having landed. */
function ledState(running: number, background: number, failed: number): 'failed' | 'running' | 'background' | 'done' {
  if (failed > 0) return 'failed';
  if (running > 0) return 'running';
  return background > 0 ? 'background' : 'done';
}
