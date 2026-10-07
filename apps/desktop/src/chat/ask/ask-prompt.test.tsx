import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride, askStore } from '@moxxy/client-core';
import type { AskRequest, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useAskPrompt, type AskPrompt } from './ask-prompt';

/**
 * One reading of a blocking question for every surface that shows it. The
 * desktop's card and the focus window's card are drawn from this, so they
 * cannot name the answers differently or favour a different one.
 */

// The IPC boundary is the one thing replaced: answers leave through it.
const invoke = vi.fn(async (_command: string, _args?: unknown) => ({ ok: true }));
beforeEach(() => {
  invoke.mockClear();
  __setApiOverride({ invoke, subscribe: () => () => undefined } as unknown as MoxxyApi);
});
afterEach(() => {
  cleanup();
  for (const pending of askStore.getAll()) askStore.resolve(pending.requestId);
  __setApiOverride(null);
});

const permission = (id: string): AskRequest => ({
  requestId: id,
  workspaceId: 'w1',
  kind: 'permission',
  tool: {
    name: 'Bash',
    input: { command: 'pnpm --filter @moxxy/desktop test -- --run src/chat/ask' },
    description: 'Run a shell command',
  },
});

const gate = (id: string, defaultOptionId = 'approve'): AskRequest => ({
  requestId: id,
  workspaceId: 'w1',
  kind: 'approval',
  approval: {
    title: 'Query plan ready',
    body: '1. One\n2. Two',
    defaultOptionId,
    options: [
      { id: 'approve', label: 'Approve and fan out' },
      { id: 'redraft', label: 'Redraft with feedback', requestsText: true, textPrompt: 'What should change?' },
      { id: 'cancel', label: 'Cancel this turn', danger: true },
    ],
  },
});

/** The question as the runner raised it: pending in the store, then read. */
function raised(ask: AskRequest) {
  askStore.add(ask);
  return renderHook(() => useAskPrompt(ask));
}

function prompt(ask: AskRequest): { current: AskPrompt } {
  const hook = raised(ask);
  if (!hook.result.current) throw new Error('no prompt');
  return hook.result as { current: AskPrompt };
}

const sent = (command: string): unknown => {
  const call = invoke.mock.calls.find(([name]) => name === command);
  return call ? call[1] : undefined;
};
const answered = (): unknown => sent('ask.respond');

describe('useAskPrompt — a tool asking leave to run', () => {
  it('names the tool, shows its call whole and leads with the narrow answer', () => {
    const { current } = prompt(permission('p1'));
    expect(current.title).toBe('Bash needs your approval');
    expect(current.label).toBe('approval required · Bash');
    expect(current.kind).toBe('caution');
    expect(current.command).toBe('pnpm --filter @moxxy/desktop test -- --run src/chat/ask');
    expect(current.prose).toBe('Run a shell command');
    expect(current.actions.map((a) => [a.label, a.tone])).toEqual([
      ['Allow once', 'primary'],
      ['Always allow Bash', 'neutral'],
      ['Deny', 'danger'],
    ]);
  });

  it('rests on the safe answer: focus goes to Deny and Escape denies', () => {
    const { current } = prompt(permission('p2'));
    expect(current.focus).toBe('deny');
    expect(current.keys).toBe('Esc denies');
    act(() => current.escape?.());
    expect(answered()).toEqual({ requestId: 'p2', response: { mode: 'deny' } });
  });

  it('answers with the verdict picked', () => {
    const { current } = prompt(permission('p3'));
    act(() => current.actions[1]?.onClick());
    expect(answered()).toEqual({ requestId: 'p3', response: { mode: 'allow_always' } });
  });
});

describe('useAskPrompt — a mode asking which way to go on', () => {
  it('carries what the agent wrote and tones the answers', () => {
    const { current } = prompt(gate('g1'));
    expect(current.title).toBe('Query plan ready');
    expect(current.kind).toBe('accent');
    expect(current.prose).toBe('1. One\n2. Two');
    expect(current.actions.map((a) => [a.label, a.tone])).toEqual([
      ['Approve and fan out', 'primary'],
      ['Redraft with feedback', 'neutral'],
      ['Cancel this turn', 'danger'],
    ]);
    expect(current.focus).toBe('approve');
  });

  it('never rests on, or escapes into, an answer that throws work away', () => {
    const { current } = prompt(gate('g2', 'cancel'));
    expect(current.focus).toBeNull();
    act(() => current.escape?.());
    expect(answered()).toBeUndefined();
  });

  it('asks for the words an answer needs, and Escape goes back to the answers', () => {
    const hook = raised(gate('g3'));
    act(() => hook.result.current?.actions[1]?.onClick());
    const step = hook.result.current;
    expect(step?.textInput?.placeholder).toBe('What should change?');
    expect(step?.focus).toBe('text');
    expect(step?.actions.map((a) => [a.label, a.disabled ?? false])).toEqual([
      ['Back', false],
      ['Redraft with feedback', true],
    ]);
    act(() => step?.textInput?.onChange('fewer questions'));
    act(() => hook.result.current?.actions[1]?.onClick());
    expect(answered()).toEqual({ requestId: 'g3', response: { optionId: 'redraft', text: 'fewer questions' } });
  });

  it('goes back to the answers on Escape from the words', () => {
    const hook = raised(gate('g4'));
    act(() => hook.result.current?.actions[1]?.onClick());
    act(() => hook.result.current?.escape?.());
    expect(hook.result.current?.textInput).toBeUndefined();
    expect(answered()).toBeUndefined();
  });
});

describe('useAskPrompt — a workflow waiting for a reply', () => {
  it('shows the step and what it asks, and sends the reply', () => {
    const ask: AskRequest = {
      requestId: 'w1',
      workspaceId: 'w1',
      kind: 'workflow',
      workflow: { runId: 'r', workflow: 'release-check', label: 'Confirm version', stepId: 'confirm', prompt: 'Ship **0.42**?' },
    } as AskRequest;
    const hook = raised(ask);
    const first = hook.result.current;
    expect(first?.title).toBe('release-check is waiting');
    expect(first?.lead).toBe('Confirm version · confirm');
    expect(first?.prose).toBe('Ship **0.42**?');
    expect(first?.focus).toBe('text');
    act(() => first?.textInput?.onChange('yes'));
    act(() => hook.result.current?.textInput?.onSubmit?.());
    expect(sent('workflows.resume')).toEqual({ runId: 'r', reply: 'yes' });
  });
});
