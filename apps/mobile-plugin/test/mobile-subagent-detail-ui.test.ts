import { describe, expect, it } from 'vitest';
import { buildSubagentDetailUi, selectSubagentDetailAgent } from '../mobile/src/subagentDetailUi';
import type { SubagentGroupTranscriptItem, SubagentTranscriptItem } from '../mobile/src/chatTranscript';

function agent(overrides: Partial<SubagentTranscriptItem> = {}): SubagentTranscriptItem {
  return {
    id: 'child-1',
    label: 'subagent-1',
    agentType: 'default',
    status: 'done',
    toolCallCount: 1,
    tokensUsed: 20800,
    responseText: 'FINDINGS: source confirmed.',
    finalPreview: 'FINDINGS: source confirmed.',
    stopReason: 'end_turn',
    error: null,
    toolCalls: [
      {
        id: 'tool-1',
        name: 'web_fetch',
        status: 'ok',
        summary: 'url: https://example.com',
        resultSummary: 'Fetched article body',
        error: null,
      },
    ],
    ...overrides,
  };
}

describe('mobile subagent detail modal ui model', () => {
  it('builds modal copy for a completed subagent with response and tools', () => {
    expect(buildSubagentDetailUi(agent())).toEqual({
      title: 'subagent-1',
      subtitle: 'default subagent',
      statusLabel: 'Done',
      statusTone: 'done',
      meta: '1 tool · 20.8k tokens · end_turn',
      responseTitle: 'Response',
      responseText: 'FINDINGS: source confirmed.',
      toolsTitle: 'Tools',
      emptyToolsText: null,
      tools: [
        {
          id: 'tool-1',
          name: 'web_fetch',
          statusLabel: 'ok',
          statusTone: 'ok',
          summary: 'url: https://example.com',
          detailLabel: 'Result',
          detail: 'Fetched article body',
        },
      ],
    });
  });

  it('keeps a running subagent readable before any final output arrives', () => {
    expect(buildSubagentDetailUi(agent({
      status: 'running',
      toolCallCount: 0,
      tokensUsed: null,
      responseText: '',
      finalPreview: null,
      stopReason: null,
      toolCalls: [],
    }))).toMatchObject({
      statusLabel: 'running',
      statusTone: 'running',
      meta: '0 tools',
      responseText: 'Working...',
      emptyToolsText: 'No tools yet.',
      tools: [],
    });
  });

  it('resolves the selected subagent from the latest group snapshot', () => {
    const firstGroup: SubagentGroupTranscriptItem = {
      id: 'subagents:first',
      kind: 'subagent-group',
      title: 'Subagents',
      collapsed: true,
      status: 'running',
      summary: '1 default agent running',
      agents: [agent({ status: 'running', toolCallCount: 1 })],
    };
    const refreshedGroup: SubagentGroupTranscriptItem = {
      ...firstGroup,
      agents: [
        agent({
          status: 'running',
          toolCallCount: 2,
          toolCalls: [
            ...firstGroup.agents[0]!.toolCalls,
            {
              id: 'tool-2',
              name: 'web_fetch',
              status: 'running',
              summary: 'url: https://example.org',
              resultSummary: null,
              error: null,
            },
          ],
        }),
      ],
    };

    expect(selectSubagentDetailAgent(firstGroup, 'child-1')?.toolCallCount).toBe(1);
    expect(selectSubagentDetailAgent(refreshedGroup, 'child-1')?.toolCallCount).toBe(2);
  });
});
