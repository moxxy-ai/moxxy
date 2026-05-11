import { describe, expect, it } from 'vitest';
import { EventLog } from './log.js';
import {
  estimateTokens,
  isToolCallResolved,
  selectCurrentTurn,
  selectMessages,
  selectPendingToolCalls,
  selectLoadedPlugins,
} from './selectors.js';
import { asPluginId, asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';

const sid = asSessionId('s1');
const tid = asTurnId('t1');
const c1 = asToolCallId('c1');
const c2 = asToolCallId('c2');

describe('selectMessages', () => {
  it('emits assistant tool_use blocks and pairs tool_result with the same id', async () => {
    const log = new EventLog();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'hi' });
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c1,
      name: 'Read',
      input: { path: '/a.txt' },
    });
    await log.append({
      type: 'tool_result',
      sessionId: sid,
      turnId: tid,
      source: 'tool',
      callId: c1,
      ok: true,
      output: 'file contents',
    });
    await log.append({
      type: 'assistant_message',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      content: 'done',
      stopReason: 'end_turn',
    });

    const messages = selectMessages(log, { includeSystem: 'sys' });
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content[0].type).toBe('tool_use');
    expect(messages[3].role).toBe('tool_result');
    const block = messages[3].content[0];
    if (block.type !== 'tool_result') throw new Error('expected tool_result block');
    expect(block.toolUseId).toBe(c1);
    expect(block.content).toBe('file contents');
  });

  it('replaces compacted ranges with summary user message', async () => {
    const log = new EventLog();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'old1' });
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'old2' });
    await log.append({
      type: 'compaction',
      sessionId: sid,
      turnId: tid,
      source: 'compactor',
      compactor: 'summarize',
      replacedRange: [0, 1],
      summary: 'TL;DR: pleasantries',
      tokensSaved: 100,
    });
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'now' });

    const msgs = selectMessages(log);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('TL;DR'),
    });
    expect(msgs[1].content[0]).toMatchObject({ text: 'now' });
  });

  it('serializes errored tool_result with [error:kind]', async () => {
    const log = new EventLog();
    await log.append({
      type: 'tool_result',
      sessionId: sid,
      turnId: tid,
      source: 'tool',
      callId: c1,
      ok: false,
      error: { message: 'boom', kind: 'threw' },
    });
    const m = selectMessages(log);
    const block = m[0].content[0];
    if (block.type !== 'tool_result') throw new Error('expected tool_result block');
    expect(block.isError).toBe(true);
    expect(block.content).toContain('[error:threw]');
  });
});

describe('selectPendingToolCalls', () => {
  it('returns unresolved calls', async () => {
    const log = new EventLog();
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c1,
      name: 'Read',
      input: {},
    });
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c2,
      name: 'Bash',
      input: {},
    });
    await log.append({
      type: 'tool_result',
      sessionId: sid,
      turnId: tid,
      source: 'tool',
      callId: c1,
      ok: true,
      output: '',
    });
    const pending = selectPendingToolCalls(log);
    expect(pending.map((p) => p.callId)).toEqual([c2]);
  });

  it('clears pending on denial', async () => {
    const log = new EventLog();
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c1,
      name: 'Bash',
      input: {},
    });
    await log.append({
      type: 'tool_call_denied',
      sessionId: sid,
      turnId: tid,
      source: 'system',
      callId: c1,
      decidedBy: 'resolver',
      reason: 'no',
    });
    expect(selectPendingToolCalls(log)).toHaveLength(0);
  });
});

describe('selectCurrentTurn', () => {
  it('returns most recent turnId', async () => {
    const log = new EventLog();
    expect(selectCurrentTurn(log)).toBeNull();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'a' });
    expect(selectCurrentTurn(log)).toBe(tid);
  });
});

describe('selectLoadedPlugins', () => {
  it('reflects register/unregister history', async () => {
    const log = new EventLog();
    const p = asPluginId('plg1');
    await log.append({
      type: 'plugin_registered',
      sessionId: sid,
      turnId: tid,
      source: 'system',
      pluginId: p,
      name: 'foo',
      version: '1.0.0',
      kind: ['tools'],
    });
    expect(selectLoadedPlugins(log)).toEqual([{ name: 'foo', version: '1.0.0' }]);
    await log.append({
      type: 'plugin_unregistered',
      sessionId: sid,
      turnId: tid,
      source: 'system',
      pluginId: p,
      name: 'foo',
      reason: 'reload',
    });
    expect(selectLoadedPlugins(log)).toEqual([]);
  });
});

describe('isToolCallResolved', () => {
  it('detects resolution via result or denial', async () => {
    const log = new EventLog();
    expect(isToolCallResolved(c1, log)).toBe(false);
    await log.append({
      type: 'tool_result',
      sessionId: sid,
      turnId: tid,
      source: 'tool',
      callId: c1,
      ok: true,
      output: '',
    });
    expect(isToolCallResolved(c1, log)).toBe(true);
  });
});

describe('estimateTokens', () => {
  it('approximates ~chars/4', () => {
    const tokens = estimateTokens([
      { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
    ]);
    expect(tokens).toBe(Math.ceil('hello world'.length / 4));
  });
});
