import { useState } from 'react';
import { formatTokensK, subagentGroupHeader, subagentState, subagentToolsLabel, type SubagentBlock, type SubagentGroupBlock, type SubagentState } from '@moxxy/chat-model';
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

  const states = block.agents.map(subagentState);

  return (
    <TraceEntry kind="subagent" testId="block-subagent-group">
      <DisclosureRow
        state={ledState(states)}
        label={subagentGroupHeader(block)}
        live={states.includes('running')}
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
      {state === 'failed' && agent.error && <p className="agent-row__error">{agent.error}</p>}
      {open && <SubagentDetail block={agent} />}
    </div>
  );
}

const STATE_WORD = { running: 'Running', background: 'In the background', done: 'Done', stopped: 'Stopped', failed: 'Failed' } as const;

/** Failure outranks live work. A group with only stopped helpers has a neutral light. */
function ledState(states: readonly SubagentState[]): SubagentState {
  if (states.includes('failed')) return 'failed';
  if (states.includes('running')) return 'running';
  if (states.includes('background')) return 'background';
  return states.length > 0 && states.every((state) => state === 'stopped') ? 'stopped' : 'done';
}
