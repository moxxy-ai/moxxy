import { describe, expect, it } from 'vitest';
import { buildChatTranscript } from '../mobile/src/chatTranscript';

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';

function subagentEvent(id: string, subtype: string, payload: Record<string, unknown>) {
  return {
    id,
    type: 'plugin_event',
    pluginId: SUBAGENT_PLUGIN_ID,
    subtype,
    payload,
  };
}

describe('mobile subagent transcript parity', () => {
  it('renders a running fan-out as a visible subagent group in the chat', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Research it' },
      subagentEvent('sg1', 'subagent_started', { childSessionId: 'child-1', label: 'round 1', agentType: 'default' }),
      subagentEvent('sg2', 'subagent_started', { childSessionId: 'child-2', label: 'round 2', agentType: 'default' }),
      subagentEvent('sg3', 'subagent_tool_call', { childSessionId: 'child-1', name: 'web_fetch', input: { url: 'https://example.com' } }),
    ]);

    expect(transcript).toContainEqual({
      id: 'subagents:sg1',
      kind: 'subagent-group',
      title: 'Subagents',
      collapsed: true,
      status: 'running',
      summary: '2 default agents running',
      agents: [
        {
          id: 'child-1',
          label: 'round 1',
          agentType: 'default',
          status: 'running',
          toolCallCount: 1,
          tokensUsed: null,
          responseText: '',
          finalPreview: null,
          stopReason: null,
          error: null,
          toolCalls: [
            {
              id: 'child-1:tool-1',
              name: 'web_fetch',
              status: 'running',
              summary: 'url: https://example.com',
              resultSummary: null,
              error: null,
            },
          ],
        },
        {
          id: 'child-2',
          label: 'round 2',
          agentType: 'default',
          status: 'running',
          toolCallCount: 0,
          tokensUsed: null,
          responseText: '',
          finalPreview: null,
          stopReason: null,
          error: null,
          toolCalls: [],
        },
      ],
    });
  });

  it('updates completed subagents with token usage and final preview', () => {
    const transcript = buildChatTranscript([
      subagentEvent('sg1', 'subagent_started', { childSessionId: 'child-1', label: 'query 1', agentType: 'Explore' }),
      subagentEvent('sg2', 'subagent_completed', {
        childSessionId: 'child-1',
        stopReason: 'end_turn',
        tokensUsed: 129300,
        text: 'Found the primary source.\nMore details follow.',
      }),
    ]);

    expect(transcript).toEqual([
      {
        id: 'subagents:sg1',
        kind: 'subagent-group',
        title: 'Subagents',
        collapsed: true,
        status: 'done',
        summary: '1 Explore agent finished',
        agents: [
          {
            id: 'child-1',
            label: 'query 1',
            agentType: 'Explore',
            status: 'done',
            toolCallCount: 0,
            tokensUsed: 129300,
            responseText: 'Found the primary source.\nMore details follow.',
            finalPreview: 'Found the primary source. More details follow.',
            stopReason: 'end_turn',
            error: null,
            toolCalls: [],
          },
        ],
      },
    ]);
  });

  it('keeps subagent response text and tool lifecycle available for a detail modal', () => {
    const transcript = buildChatTranscript([
      subagentEvent('sg1', 'subagent_started', { childSessionId: 'child-1', label: 'subagent-1', agentType: 'default' }),
      subagentEvent('sg2', 'subagent_chunk', { childSessionId: 'child-1', delta: 'FINDINGS: source ' }),
      subagentEvent('sg3', 'subagent_tool_call', {
        childSessionId: 'child-1',
        callId: 'tool-1',
        name: 'web_fetch',
        input: { url: 'https://example.com', format: 'text' },
      }),
      subagentEvent('sg4', 'subagent_tool_result', {
        childSessionId: 'child-1',
        callId: 'tool-1',
        ok: true,
        output: 'Fetched article body',
      }),
      subagentEvent('sg5', 'subagent_chunk', { childSessionId: 'child-1', delta: 'confirmed.' }),
      subagentEvent('sg6', 'subagent_completed', {
        childSessionId: 'child-1',
        stopReason: 'end_turn',
        tokensUsed: 20800,
        text: 'FINDINGS: source confirmed.',
      }),
    ]);

    expect(transcript).toMatchObject([
      {
        kind: 'subagent-group',
        agents: [
          {
            id: 'child-1',
            responseText: 'FINDINGS: source confirmed.',
            toolCalls: [
              {
                id: 'tool-1',
                name: 'web_fetch',
                status: 'ok',
                summary: 'url: https://example.com · format: text',
                resultSummary: 'Fetched article body',
                error: null,
              },
            ],
          },
        ],
      },
    ]);
  });

  it('marks completed subagents with an error payload as failed', () => {
    const transcript = buildChatTranscript([
      subagentEvent('sg1', 'subagent_started', { childSessionId: 'child-1', label: 'query 1' }),
      subagentEvent('sg2', 'subagent_completed', {
        childSessionId: 'child-1',
        error: 'tool loop detected',
        tokensUsed: 2300,
      }),
    ]);

    expect(transcript).toEqual([
      {
        id: 'subagents:sg1',
        kind: 'subagent-group',
        title: 'Subagents',
        collapsed: true,
        status: 'failed',
        summary: '1 of 1 agent failed',
        agents: [
          {
            id: 'child-1',
            label: 'query 1',
            agentType: 'default',
            status: 'failed',
            toolCallCount: 0,
            tokensUsed: 2300,
            responseText: '',
            finalPreview: null,
            stopReason: null,
            error: 'tool loop detected',
            toolCalls: [],
          },
        ],
      },
    ]);
  });
});
