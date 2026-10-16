/**
 * Every session update the Agent Client Protocol defines — its `SessionUpdate`
 * kinds, listed in fixtures/ — checked against what Moxxy does with it: shown
 * in the chat, or left alone for the reason given. A kind the protocol adds
 * becomes a decision here instead of something lost without a trace. A tool
 * shows whatever it is called: one Moxxy has no formatting for is a plain call.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AcpSessionUpdate } from './protocol.js';
import { AcpTurnTranslator } from './translate.js';

const kinds = JSON.parse(readFileSync(new URL('./fixtures/acp-session-updates.json', import.meta.url), 'utf8')) as { readonly updates: ReadonlyArray<string> };

/** The kinds that show, each with an update of that kind. */
const SHOWN: Record<string, AcpSessionUpdate> = {
  agent_message_chunk: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } },
  agent_thought_chunk: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Looking.' } },
  tool_call: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'read', kind: 'read', status: 'in_progress', rawInput: { filePath: '/repo/a.txt' } },
  tool_call_update: { sessionUpdate: 'tool_call_update', toolCallId: 'c2', title: 'read', kind: 'read', status: 'completed', rawInput: { filePath: '/repo/a.txt' }, rawOutput: { output: 'hi' } },
  plan: { sessionUpdate: 'plan', entries: [{ content: 'Read the code', priority: 'high', status: 'pending' }] },
};

/** The kinds Moxxy leaves out of the chat, and why. */
const LEFT_ALONE: Record<string, string> = {
  user_message_chunk: "the person's own message, which Moxxy already shows (sent again when a session is loaded)",
  available_commands_update: "the session reads the agent's commands and skills from it, so a Moxxy skill of the same name is left to the agent's",
  config_option_update: 'the agent reporting its model, mode and effort, which Moxxy sets itself',
  current_mode_update: 'the agent reporting its mode, which Moxxy sets itself',
  session_info_update: "the session's title and details, for the agent's own list",
  usage_update: "how full the agent's context is, not the tokens of the turn",
  notice: "a note for the agent's own screen",
  compaction_update: "the agent shortening its own context; Moxxy's record of the conversation stays whole",
  compaction_summary_chunk: "the agent shortening its own context; Moxxy's record of the conversation stays whole",
};

describe('every session update ACP defines', () => {
  it('has a decision here, so a kind the protocol adds needs one', () => {
    expect([...Object.keys(SHOWN), ...Object.keys(LEFT_ALONE)].sort()).toEqual([...kinds.updates]);
  });

  it.each(Object.keys(SHOWN))('%s shows in the chat', (kind) => {
    const update = SHOWN[kind];

    expect(update?.sessionUpdate).toBe(kind);
    expect(update ? new AcpTurnTranslator('moxxy_', '/repo').update(update).length : 0).toBeGreaterThan(0);
  });

  it.each(Object.keys(LEFT_ALONE))('%s leaves the chat as it is', (kind) => {
    expect(new AcpTurnTranslator('moxxy_', '/repo').update({ sessionUpdate: kind })).toEqual([]);
  });
});

describe('a tool Moxxy has no formatting for', () => {
  it('shows as a call by its name, with its result', () => {
    const t = new AcpTurnTranslator('moxxy_', '/repo');

    expect(t.update({ sessionUpdate: 'tool_call', toolCallId: 'm1', title: 'lsp_hover', kind: 'other', status: 'in_progress', rawInput: { line: 3 } })).toEqual([
      expect.objectContaining({ type: 'tool_call', callId: 'm1', name: 'lsp_hover' }),
    ]);
    expect(t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'm1', status: 'completed', rawOutput: { output: 'a number' } })).toEqual([
      expect.objectContaining({ type: 'tool_result', callId: 'm1', ok: true }),
    ]);
  });
});
