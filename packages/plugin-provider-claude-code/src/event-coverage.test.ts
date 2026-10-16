/**
 * Every message the Claude Agent SDK 0.3.296 can send — its `SDKMessage`
 * union, listed in fixtures/ — checked against what Moxxy does with it: shown
 * in the chat, or left alone for the reason given. A newer SDK brings a new
 * fixture, and each kind it adds becomes a decision here instead of something
 * lost without a trace. A tool shows whatever its name: one Moxxy has no
 * formatting for is a plain call.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClaudeMessage } from './sdk-types.js';
import { TurnTranslator } from './translate.js';

const kinds = JSON.parse(readFileSync(new URL('./fixtures/claude-agent-sdk-0.3.296.json', import.meta.url), 'utf8')) as { readonly messages: ReadonlyArray<string> };

const message = (fields: Record<string, unknown>): ClaudeMessage => fields as unknown as ClaudeMessage;
const assistant = (content: unknown[], parent: string | null = null) => message({ type: 'assistant', message: { content }, parent_tool_use_id: parent });
const toolResult = (id: string, content: unknown, toolUseResult?: unknown) =>
  message({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] }, parent_tool_use_id: null, ...(toolUseResult ? { tool_use_result: toolUseResult } : {}) });

/** The kinds that show, each with messages that lead to it; the last one must show something. */
const SHOWN: Record<string, ReadonlyArray<ClaudeMessage>> = {
  'system/init': [message({ type: 'system', subtype: 'init', session_id: 's-1', permissionMode: 'default' })],
  'system/status': [message({ type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits' })],
  stream_event: [message({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }, parent_tool_use_id: null })],
  assistant: [assistant([{ type: 'text', text: 'Done.' }])],
  user: [assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/a.txt' } }]), toolResult('t1', 'hello')],
  rate_limit_event: [message({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } })],
  'system/task_notification': [
    assistant([{ type: 'tool_use', id: 'agent-1', name: 'Agent', input: { description: 'List files', prompt: 'list', subagent_type: 'Explore' } }]),
    toolResult('agent-1', 'Async agent launched', { isAsync: true, status: 'async_launched' }),
    message({ type: 'system', subtype: 'task_notification', tool_use_id: 'agent-1', status: 'completed', summary: 'Two files.' }),
  ],
};

/** The kinds Moxxy leaves out of the chat, and why. */
const LEFT_ALONE: Record<string, string> = {
  result: "ends the turn; the session reads it, with Claude's error when it failed",
  'system/task_started': 'the session reads it to follow a background subagent',
  'system/task_progress': "its tokens go into the subagent's row when it ends",
  'system/task_updated': "the subagent's row shows its start and end",
  'system/background_tasks_changed': "the subagent's row shows its start and end",
  'system/compact_boundary': "Claude shortening its own context; Moxxy's record of the conversation stays whole",
  'system/api_retry': 'Claude retries by itself; a failure that stays ends the turn with its error',
  'system/model_refusal_fallback': 'Claude moved to another model by itself and carries on',
  'system/model_refusal_no_fallback': "the turn's result carries what happened",
  'system/permission_denied': "the refused call's result says so",
  'system/hook_started': "the person's own Claude hooks, which run for their own Claude",
  'system/hook_progress': "the person's own Claude hooks, which run for their own Claude",
  'system/hook_response': "the person's own Claude hooks, which run for their own Claude",
  'system/local_command_output': 'output of a slash command, which Moxxy sends only without showing it (`/goal`)',
  'system/memory_recall': "Claude's own memory, which it reads for itself",
  'system/files_persisted': "the files show in the calls that wrote them",
  'system/elicitation_complete': 'an MCP server question, answered through the call it belongs to',
  'system/control_request_progress': "progress of Moxxy's own requests to Claude",
  'system/thinking_tokens': 'a count; the reasoning shows itself',
  'system/session_state_changed': "Claude's session state; Moxxy follows its turn by its messages",
  'system/worker_shutting_down': 'Claude stopping; Moxxy sees the session end',
  'system/commands_changed': "Claude's slash commands, which Moxxy does not list",
  'system/plugin_install': "the person's Claude plugins, installed for their own Claude",
  'system/notification': "notes for Claude Code's own screen",
  'system/informational': "notes for Claude Code's own screen",
  'system/mirror_error': "Claude Code's mirroring of the session elsewhere",
  tool_progress: 'the call shows whole once it ends',
  tool_use_summary: 'the calls it sums up show themselves',
  auth_status: 'sign-in, which Moxxy checks itself',
  prompt_suggestion: "a next message Claude suggests, for Claude Code's own screen",
  conversation_reset: "Claude Code's /clear, which Moxxy does not send",
};

const kindOf = (fields: Record<string, unknown>): string => (fields.type === 'system' ? `system/${String(fields.subtype)}` : String(fields.type));

describe('every message the Claude Agent SDK 0.3.296 can send', () => {
  it('has a decision here, so a kind a newer SDK adds needs one', () => {
    expect([...Object.keys(SHOWN), ...Object.keys(LEFT_ALONE)].sort()).toEqual([...kinds.messages]);
  });

  it.each(Object.keys(SHOWN))('%s shows in the chat', (kind) => {
    const translator = new TurnTranslator();
    const messages = SHOWN[kind] ?? [];
    const last = messages.at(-1);
    for (const earlier of messages.slice(0, -1)) translator.translate(earlier);

    expect(last && kindOf(last as unknown as Record<string, unknown>)).toBe(kind);
    expect(last ? translator.translate(last).length : 0).toBeGreaterThan(0);
  });

  it.each(Object.keys(LEFT_ALONE))('%s leaves the chat as it is', (kind) => {
    const [type, subtype] = kind.split('/');
    const alone = message({ type, ...(subtype ? { subtype } : {}), session_id: 's-1', uuid: 'u-1' });

    expect(new TurnTranslator().translate(alone)).toEqual([]);
  });
});

describe('a tool Moxxy has no formatting for', () => {
  it('shows as a call by its name, with its result', () => {
    const translator = new TurnTranslator();

    expect(translator.translate(assistant([{ type: 'tool_use', id: 'm1', name: 'Monitor', input: { command: 'tail -f log' } }]))).toEqual([
      { type: 'tool_call', callId: 'm1', name: 'Monitor', input: { command: 'tail -f log' } },
    ]);
    expect(translator.translate(toolResult('m1', 'watching'))).toEqual([{ type: 'tool_result', callId: 'm1', ok: true, output: 'watching' }]);
  });
});
