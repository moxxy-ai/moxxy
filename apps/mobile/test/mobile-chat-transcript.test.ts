import { describe, expect, it } from 'vitest';
import { buildChatTranscript } from '../src/chatTranscript';

describe('mobile chat transcript model', () => {
  it('folds streamed assistant chunks into one assistant message instead of event cards', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Powiedz OK' },
      { id: 'c1', type: 'assistant_chunk', delta: 'O' },
      { id: 'c2', type: 'assistant_chunk', delta: 'K' },
      { id: 'pr1', type: 'provider_response', usage: { inputTokens: 10 } },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Powiedz OK' },
      { id: 'assistant-stream:c1', kind: 'assistant', label: 'Assistant', text: 'OK', streaming: true },
    ]);
  });

  it('treats event type as the source of truth when assistant chunks also carry a role', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Pisz' },
      { id: 'c1', type: 'assistant_chunk', role: 'assistant', delta: 'Live ' },
      { id: 'c2', type: 'assistant_chunk', role: 'assistant', delta: 'tekst' },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Pisz' },
      { id: 'assistant-stream:c1', kind: 'assistant', label: 'Assistant', text: 'Live tekst', streaming: true },
    ]);
  });

  it('uses the final assistant_message as the committed response and hides provider bookkeeping', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Powiedz OK' },
      { id: 'c1', type: 'assistant_chunk', delta: 'O' },
      { id: 'c2', type: 'assistant_chunk', delta: 'K' },
      { id: 'pr1', type: 'provider_response', usage: { inputTokens: 10 } },
      { id: 'a1', type: 'assistant_message', content: 'OK', stopReason: 'end_turn' },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Powiedz OK' },
      { id: 'a1', kind: 'assistant', label: 'Assistant', text: 'OK', streaming: false, stopReason: 'end_turn' },
    ]);
  });

  it('deduplicates replayed event ids before building React keyed transcript items', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Powiedz OK' },
      { id: 'u1', type: 'user_prompt', text: 'Powiedz OK' },
      { id: 'c1', type: 'assistant_chunk', delta: 'O' },
      { id: 'c1', type: 'assistant_chunk', delta: 'O' },
      { id: 'c2', type: 'assistant_chunk', delta: 'K' },
      { id: 'a1', type: 'assistant_message', content: 'OK' },
      { id: 'a1', type: 'assistant_message', content: 'OK' },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Powiedz OK' },
      { id: 'a1', kind: 'assistant', label: 'Assistant', text: 'OK', streaming: false },
    ]);
    expect(new Set(transcript.map((item) => item.id)).size).toBe(transcript.length);
  });

  it('keeps user prompt attachments available for rendering in the chat', () => {
    const transcript = buildChatTranscript([
      {
        id: 'u1',
        type: 'user_prompt',
        text: 'Przeanalizuj',
        attachments: [
          { kind: 'image', content: 'AQID', mediaType: 'image/png', name: 'screen.png' },
        ],
      },
    ]);

    expect(transcript).toEqual([
      {
        id: 'u1',
        kind: 'user',
        text: 'Przeanalizuj',
        attachments: [
          { kind: 'image', content: 'AQID', mediaType: 'image/png', name: 'screen.png' },
        ],
      },
    ]);
  });

  it('collapses runtime tool events into one closed tool group by default', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Sprawdź pliki' },
      { id: 't1', type: 'tool_call_requested', callId: 'call-1', name: 'Read', input: { path: 'a.ts' } },
      { id: 't2', type: 'tool_result', callId: 'call-1', output: 'ok' },
      { id: 't3', type: 'tool_call_requested', callId: 'call-2', name: 'Bash', input: { command: 'pwd' } },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Sprawdź pliki' },
      {
        id: 'tools:call-1',
        kind: 'tool-group',
        title: 'Tools',
        collapsed: true,
        summary: '1 ok · 1 running',
        tools: [
          { id: 'call-1', name: 'Read', status: 'ok', summary: 'path: a.ts', resultSummary: 'ok' },
          { id: 'call-2', name: 'Bash', status: 'running', summary: 'command: pwd' },
        ],
      },
    ]);
  });

  it('keeps tool result details so mobile can expand completed tools', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Sprawdź stronę' },
      {
        id: 't1',
        type: 'tool_call_requested',
        callId: 'fetch-1',
        name: 'web_fetch',
        input: { url: 'https://example.com', format: 'markdown' },
      },
      {
        id: 't2',
        type: 'tool_result',
        callId: 'fetch-1',
        ok: true,
        output: { text: 'HTTP 200 Example Domain body text' },
      },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Sprawdź stronę' },
      {
        id: 'tools:fetch-1',
        kind: 'tool-group',
        title: 'Tools',
        collapsed: true,
        summary: '1 ok',
        tools: [
          {
            id: 'fetch-1',
            name: 'web_fetch',
            status: 'ok',
            summary: 'url: https://example.com · format: markdown',
            resultSummary: 'HTTP 200 Example Domain body text',
          },
        ],
      },
    ]);
  });

  it('keeps tool error details so mobile can expand failed tools', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Kliknij' },
      {
        id: 't1',
        type: 'tool_call_requested',
        callId: 'click-1',
        name: 'computer_click',
        input: { x: 12, y: 24 },
      },
      {
        id: 't2',
        type: 'tool_result',
        callId: 'click-1',
        ok: false,
        error: { message: 'System Events error -25208' },
      },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Kliknij' },
      {
        id: 'tools:click-1',
        kind: 'tool-group',
        title: 'Tools',
        collapsed: true,
        summary: '1 failed',
        tools: [
          {
            id: 'click-1',
            name: 'computer_click',
            status: 'error',
            summary: 'x: 12 · y: 24',
            error: 'System Events error -25208',
          },
        ],
      },
    ]);
  });

  it('keeps running and failed tool states visible from mixed lifecycle events', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Sprawdź' },
      { id: 't1', type: 'tool_call_requested', callId: 'call-running', name: 'Read', input: { path: 'a.ts' } },
      { id: 't2', type: 'tool_call_requested', callId: 'call-error', name: 'Bash', input: { command: 'bad' } },
      { id: 't3', type: 'tool_result', callId: 'call-error', error: { message: 'boom', kind: 'threw' } },
      { id: 't4', type: 'tool_call_requested', callId: 'call-is-error', name: 'Fetch', input: { url: 'https://example.com' } },
      { id: 't5', type: 'tool_result', callId: 'call-is-error', isError: true, output: 'failed' },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Sprawdź' },
      {
        id: 'tools:call-running',
        kind: 'tool-group',
        title: 'Tools',
        collapsed: true,
        summary: '2 failed · 1 running',
        tools: [
          { id: 'call-running', name: 'Read', status: 'running', summary: 'path: a.ts' },
          { id: 'call-error', name: 'Bash', status: 'error', summary: 'command: bad', error: 'boom' },
          { id: 'call-is-error', name: 'Fetch', status: 'error', summary: 'url: https://example.com', error: 'failed' },
        ],
      },
    ]);
  });

  it('pairs bridge-style tool ids with their results', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Sprawdź' },
      { id: 't1', type: 'tool_call_requested', toolUseId: 'bridge-call', name: 'Read', input: { path: 'a.ts' } },
      { id: 't2', type: 'tool_result', toolUseId: 'bridge-call', ok: true, output: 'ok' },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Sprawdź' },
      {
        id: 'tools:bridge-call',
        kind: 'tool-group',
        title: 'Tools',
        collapsed: true,
        summary: '1 ok',
        tools: [
          { id: 'bridge-call', name: 'Read', status: 'ok', summary: 'path: a.ts', resultSummary: 'ok' },
        ],
      },
    ]);
  });

  it('keeps one tool group when a skill event arrives between request and result', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Użyj skilla imagegen' },
      { id: 't1', type: 'tool_call_requested', callId: 'call-1', name: 'Bash', input: { command: 'pwd' } },
      { id: 's1', type: 'skill_invoked', title: 'imagegen', text: 'Using image generation skill' },
      { id: 't2', type: 'tool_call_approved', callId: 'call-1', name: 'Bash' },
      { id: 't3', type: 'tool_result', callId: 'call-1', ok: true, output: 'ok' },
    ]);

    const toolGroups = transcript.filter((item) => item.kind === 'tool-group');

    expect(new Set(transcript.map((item) => item.id)).size).toBe(transcript.length);
    expect(toolGroups).toEqual([
      {
        id: 'tools:call-1',
        kind: 'tool-group',
        title: 'Tools',
        collapsed: true,
        summary: '1 ok',
        tools: [
          { id: 'call-1', name: 'Bash', status: 'ok', summary: 'command: pwd', resultSummary: 'ok' },
        ],
      },
    ]);
  });

  it('keeps transcript item ids unique when later turns reuse a tool call id', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Pierwszy turn' },
      { id: 't1', type: 'tool_call_requested', callId: 'call-reused', name: 'Read', input: { path: 'a.ts' } },
      { id: 't2', type: 'tool_result', callId: 'call-reused', ok: true, output: 'ok' },
      { id: 'u2', type: 'user_prompt', text: 'Drugi turn' },
      { id: 't3', type: 'tool_call_requested', callId: 'call-reused', name: 'Read', input: { path: 'b.ts' } },
      { id: 't4', type: 'tool_result', callId: 'call-reused', ok: true, output: 'ok' },
    ]);

    expect(transcript.map((item) => item.id)).toEqual([
      'u1',
      'tools:call-reused',
      'u2',
      'tools:call-reused:2',
    ]);
    expect(new Set(transcript.map((item) => item.id)).size).toBe(transcript.length);
  });

  it('renders model reasoning between tool batches as its own reasoning item', () => {
    const transcript = buildChatTranscript([
      { id: 't1', type: 'tool_call_completed', name: 'Bash', status: 'ok' },
      { id: 'r1', type: 'reasoning_message', content: 'Now I should verify the file exists.' },
      { id: 't2', type: 'tool_call_completed', name: 'Bash', status: 'ok' },
      { id: 'a1', type: 'assistant_message', content: 'Done.' },
    ]);

    const reasoning = transcript.find((item) => item.kind === 'reasoning');
    expect(reasoning).toMatchObject({ id: 'r1', kind: 'reasoning', text: 'Now I should verify the file exists.' });
    expect(transcript.filter((item) => item.kind === 'tool-group')).toHaveLength(2);
    expect(transcript.map((item) => item.kind)).toEqual(['tool-group', 'reasoning', 'tool-group', 'assistant']);
  });

  it('never displays redacted/encrypted reasoning', () => {
    const transcript = buildChatTranscript([
      { id: 'r1', type: 'reasoning_message', content: 'secret', redacted: true },
      { id: 'a1', type: 'assistant_message', content: 'Hi.' },
    ]);
    expect(transcript.some((item) => item.kind === 'reasoning')).toBe(false);
  });
});

describe('turns something other than the person started', () => {
  it('shows one as a marker saying what started it, not as the person message', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'List files finished in the background', origin: { kind: 'agent', name: 'List files finished in the background' } },
    ]);

    expect(transcript).toEqual([{ id: 'u1', kind: 'trigger', label: 'Agent continued', name: 'List files finished in the background' }]);
  });
});

describe('an agent helper that outlives its turn', () => {
  const sub = (id: string, subtype: string, payload: Record<string, unknown>) => ({ id, type: 'plugin_event', pluginId: '@moxxy/subagents', subtype, payload });

  it('says it went on in the background, and shows what it did later in a row of its own', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'List the files in the background' },
      sub('s1', 'subagent_started', { childSessionId: 'bg1', label: 'List files', agentType: 'general-purpose' }),
      { id: 'u2', type: 'user_prompt', text: 'List files finished in the background', origin: { kind: 'agent', name: 'List files finished in the background' } },
      sub('s2', 'subagent_tool_call', { childSessionId: 'bg1', name: 'Bash', input: { command: 'ls' } }),
      sub('s3', 'subagent_completed', { childSessionId: 'bg1', text: 'Two files.' }),
    ]);

    const groups = transcript.filter((item) => item.kind === 'subagent-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ status: 'background', summary: '1 general-purpose agent in the background', agents: [{ status: 'background', toolCallCount: 0 }] });
    expect(groups[1]).toMatchObject({
      status: 'done',
      summary: '1 general-purpose agent finished in the background',
      agents: [{ label: 'List files', continued: true, status: 'done', toolCallCount: 1, finalPreview: 'Two files.' }],
    });
  });
});

describe("an agent's account limit", () => {
  const limit = (id: string, state: string) => ({
    id,
    type: 'plugin_event',
    pluginId: '@moxxy/agent-connection',
    subtype: 'account_limit',
    ts: new Date(2026, 9, 12, 14, 0).getTime(),
    payload: { provider: 'codex-agent', agent: 'Codex', limit: { state, windowMinutes: 300, resetsAt: new Date(2026, 9, 12, 18, 0).getTime() } },
  });

  it('says where the turn stopped that the limit is used up and when it resets, as the desktop does', () => {
    expect(buildChatTranscript([limit('l1', 'reached')])).toEqual([
      { id: 'l1', kind: 'error', label: 'Limit', text: "Codex's 5-hour limit is used up · resets at 18:00" },
    ]);
  });

  it('shows nothing in the conversation for a limit with room left', () => {
    expect(buildChatTranscript([limit('l2', 'near')])).toEqual([]);
  });
});
