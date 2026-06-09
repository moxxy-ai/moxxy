import { describe, expect, it } from 'vitest';
import { buildChatTranscript } from '../chatTranscript';

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
          { id: 'call-1', name: 'Read', status: 'ok', summary: 'path: a.ts' },
          { id: 'call-2', name: 'Bash', status: 'running', summary: 'command: pwd' },
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
          { id: 'call-error', name: 'Bash', status: 'error', summary: 'command: bad' },
          { id: 'call-is-error', name: 'Fetch', status: 'error', summary: 'url: https://example.com' },
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
          { id: 'bridge-call', name: 'Read', status: 'ok', summary: 'path: a.ts' },
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
          { id: 'call-1', name: 'Bash', status: 'ok', summary: 'command: pwd' },
        ],
      },
    ]);
  });
});
