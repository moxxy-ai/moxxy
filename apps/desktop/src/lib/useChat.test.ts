/**
 * useChat reducer tests — exercise the event-to-block coalescing
 * directly so they're fast (no React render needed) and focused.
 */

import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { reducerForTest } from './useChat-testing';

const baseEvt = {
  id: 'evt-x' as unknown as MoxxyEvent['id'],
  seq: 0,
  turnId: 'T1' as unknown as MoxxyEvent['turnId'],
  at: 1,
  ts: 1,
  sessionId: 'S' as unknown as MoxxyEvent['sessionId'],
  source: 'test',
};

function userPrompt(text: string): MoxxyEvent {
  return { ...baseEvt, type: 'user_prompt', text } as MoxxyEvent;
}
function chunk(delta: string): MoxxyEvent {
  return { ...baseEvt, type: 'assistant_chunk', delta } as MoxxyEvent;
}
function assistant(content: string, stopReason = 'end_turn'): MoxxyEvent {
  return {
    ...baseEvt,
    type: 'assistant_message',
    content,
    stopReason: stopReason as 'end_turn',
  } as MoxxyEvent;
}
function toolRequested(callId: string, name: string, input: unknown): MoxxyEvent {
  return {
    ...baseEvt,
    type: 'tool_call_requested',
    callId: callId as unknown as { readonly [k: string]: unknown },
    name,
    input,
  } as unknown as MoxxyEvent;
}
function toolResult(callId: string, ok: boolean, output?: unknown): MoxxyEvent {
  const base = {
    ...baseEvt,
    type: 'tool_result' as const,
    callId: callId as unknown as { readonly [k: string]: unknown },
    ok,
  };
  return (output === undefined ? base : { ...base, output }) as unknown as MoxxyEvent;
}
function errorEvent(message: string): MoxxyEvent {
  return {
    ...baseEvt,
    type: 'error',
    kind: 'fatal',
    message,
  } as MoxxyEvent;
}

describe('useChat reducer', () => {
  it('starts empty', () => {
    const s = reducerForTest.initial();
    expect(s.blocks).toEqual([]);
    expect(s.sending).toBe(false);
    expect(s.activeTurnId).toBeNull();
  });

  it('adds a user block on send_started', () => {
    const after = reducerForTest.apply(reducerForTest.initial(), {
      type: 'send_started',
      turnId: 'T1',
      prompt: 'hello',
    });
    expect(after.blocks).toEqual([
      expect.objectContaining({ kind: 'user', text: 'hello' }),
    ]);
    expect(after.activeTurnId).toBe('T1');
  });

  it('coalesces assistant chunks into one streaming block', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, { type: 'event', event: chunk('hel') });
    s = reducerForTest.apply(s, { type: 'event', event: chunk('lo') });
    s = reducerForTest.apply(s, { type: 'event', event: chunk('!') });
    const last = s.blocks.at(-1);
    expect(last).toMatchObject({ kind: 'assistant', text: 'hello!', streaming: true });
  });

  it('finalises the streaming block on assistant_message', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, { type: 'event', event: chunk('hi') });
    s = reducerForTest.apply(s, {
      type: 'event',
      event: assistant('hi.', 'end_turn'),
    });
    const last = s.blocks.at(-1);
    expect(last).toMatchObject({ kind: 'assistant', text: 'hi.', streaming: false });
  });

  it('adds a fresh assistant block when no streaming block is open', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, {
      type: 'event',
      event: assistant('done.', 'end_turn'),
    });
    expect(s.blocks.filter((b) => b.kind === 'assistant')).toHaveLength(1);
  });

  it('keeps tool calls separate and updates the right callId on tool_result', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, {
      type: 'event',
      event: toolRequested('c1', 'grep', { q: 'foo' }),
    });
    s = reducerForTest.apply(s, {
      type: 'event',
      event: toolRequested('c2', 'write', { path: 'x' }),
    });
    s = reducerForTest.apply(s, {
      type: 'event',
      event: toolResult('c1', true, ['hit']),
    });
    const tools = s.blocks.filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(2);
    const grep = tools.find((t) => t.kind === 'tool' && t.callId === 'c1');
    const write = tools.find((t) => t.kind === 'tool' && t.callId === 'c2');
    expect(grep).toMatchObject({ status: 'ok' });
    expect(write).toMatchObject({ status: 'running' });
  });

  it('renders tool_result with error.message when ok=false', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, {
      type: 'event',
      event: toolRequested('c1', 'grep', {}),
    });
    s = reducerForTest.apply(s, {
      type: 'event',
      event: {
        ...baseEvt,
        type: 'tool_result',
        callId: 'c1' as unknown as { readonly [k: string]: unknown },
        ok: false,
        error: { message: 'boom', kind: 'threw' },
      } as unknown as MoxxyEvent,
    });
    const tool = s.blocks.find((b) => b.kind === 'tool');
    expect(tool).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('renders error events as a system block', () => {
    const s = reducerForTest.apply(reducerForTest.initial(), {
      type: 'event',
      event: errorEvent('runner crashed'),
    });
    expect(s.blocks.at(-1)).toMatchObject({
      kind: 'system',
      text: 'runner crashed',
      tone: 'error',
    });
  });

  it('does NOT duplicate the user block when user_prompt arrives after send_started', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'hi' });
    s = reducerForTest.apply(s, { type: 'event', event: userPrompt('hi') });
    const users = s.blocks.filter((b) => b.kind === 'user');
    expect(users).toHaveLength(1);
  });

  it('closes any open streaming block on turn_complete', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, { type: 'event', event: chunk('partial') });
    s = reducerForTest.apply(s, { type: 'turn_complete', turnId: 'T1', error: null });
    const last = s.blocks.find((b) => b.kind === 'assistant');
    expect(last).toMatchObject({ streaming: false });
    expect(s.activeTurnId).toBeNull();
    expect(s.sending).toBe(false);
  });

  it('appends an error system block when turn_complete carries an error', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, {
      type: 'turn_complete',
      turnId: 'T1',
      error: 'rate limited',
    });
    const lastSystem = s.blocks.reverse().find((b) => b.kind === 'system');
    expect(lastSystem).toMatchObject({ tone: 'error', text: 'rate limited' });
  });

  it('clear() resets everything', () => {
    let s = reducerForTest.initial();
    s = reducerForTest.apply(s, { type: 'send_started', turnId: 'T1', prompt: 'q' });
    s = reducerForTest.apply(s, { type: 'event', event: chunk('hi') });
    s = reducerForTest.apply(s, { type: 'clear' });
    expect(s.blocks).toEqual([]);
    expect(s.activeTurnId).toBeNull();
  });
});
