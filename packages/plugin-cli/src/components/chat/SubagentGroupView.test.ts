import { describe, expect, it } from 'vitest';
import { subagentGroupHeader, type SubagentBlock, type SubagentGroupBlock } from '@moxxy/chat-model';
import { subagentStatusText } from './SubagentGroupView.js';

const agent = (patch: Partial<SubagentBlock> = {}): SubagentBlock => ({
  kind: 'subagent',
  id: 'a1',
  childSessionId: 'c1',
  label: 'List files',
  agentType: 'general-purpose',
  startedAtMs: 0,
  completedAtMs: 1000,
  toolCallCount: 2,
  tokensUsed: 900,
  toolCalls: [],
  stopReason: 'end_turn',
  finalPreview: 'Two files.',
  error: null,
  ...patch,
});
const group = (agents: SubagentBlock[]): SubagentGroupBlock => ({ kind: 'subagent-group', id: 'g1', agentType: 'general-purpose', agents });

describe("an agent's helpers in the terminal", () => {
  it('says a helper went on in the background when its turn ended', () => {
    const left = agent({ completedAtMs: null, backgrounded: true });
    expect(subagentGroupHeader(group([left]))).toBe('1 general-purpose agent in the background');
    expect(subagentStatusText(left)).toBe('going on in the background');
  });

  it('marks the row where a helper reports back from the background', () => {
    const back = agent({ continued: true });
    expect(subagentGroupHeader(group([back]))).toBe('1 general-purpose agent finished in the background');
    expect(subagentStatusText(back)).toBe('Done in the background');
  });

  it('reads as before for a helper that finished in its turn', () => {
    expect(subagentGroupHeader(group([agent()]))).toBe('1 general-purpose agent finished');
    expect(subagentStatusText(agent())).toBe('Done');
  });
});
