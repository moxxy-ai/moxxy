/**
 * useAgentSurfaceReveal — auto-open the rail pane that showcases the agent's
 * work. Locks down:
 *   1. browser_session → reveal 'browser'; terminal → reveal 'terminal'.
 *   2. Events for OTHER workspaces are ignored.
 *   3. Each pane is revealed at most once per session (no fighting the user).
 *   4. Non-tool events / unrelated tools never reveal.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { useAgentSurfaceReveal } from './useAgentSurfaceReveal';

function installFakeApi(): { emit: (payload: unknown) => void } {
  const subs = new Set<(payload: unknown) => void>();
  __setApiOverride({
    invoke: (() => Promise.resolve(undefined)) as never,
    subscribe: ((channel: string, cb: (payload: unknown) => void) => {
      if (channel === 'runner.event') subs.add(cb);
      return () => subs.delete(cb);
    }) as never,
  } as never);
  return { emit: (payload) => subs.forEach((cb) => cb(payload)) };
}

const toolEvent = (
  workspaceId: string,
  name: string,
  input: Record<string, unknown> = {},
): unknown => ({
  workspaceId,
  event: { type: 'tool_call_requested', turnId: 't1', callId: 'c1', name, input },
});

afterEach(() => __setApiOverride(null));

describe('useAgentSurfaceReveal', () => {
  it('reveals browser/terminal panes for the matching tool', () => {
    const spy = installFakeApi();
    const revealed: string[] = [];
    renderHook(() => useAgentSurfaceReveal('ws-1', (p) => revealed.push(p)));

    spy.emit(toolEvent('ws-1', 'browser_session'));
    spy.emit(toolEvent('ws-1', 'terminal'));
    expect(revealed).toEqual(['browser', 'terminal']);
  });

  it('ignores events for other workspaces and unrelated tools', () => {
    const spy = installFakeApi();
    const revealed: string[] = [];
    renderHook(() => useAgentSurfaceReveal('ws-1', (p) => revealed.push(p)));

    spy.emit(toolEvent('ws-OTHER', 'browser_session'));
    spy.emit(toolEvent('ws-1', 'read_file'));
    spy.emit({ workspaceId: 'ws-1', event: { type: 'assistant_chunk', turnId: 't1', delta: 'hi' } });
    expect(revealed).toEqual([]);
  });

  it('reveals each pane at most once per session', () => {
    const spy = installFakeApi();
    const revealed: string[] = [];
    renderHook(() => useAgentSurfaceReveal('ws-1', (p) => revealed.push(p)));

    spy.emit(toolEvent('ws-1', 'browser_session'));
    spy.emit(toolEvent('ws-1', 'browser_session'));
    spy.emit(toolEvent('ws-1', 'browser_session'));
    expect(revealed).toEqual(['browser']);
  });

  it('reveals the file pane for Write/Edit with the file path + mode', () => {
    const spy = installFakeApi();
    const calls: Array<{ pane: string; file?: { path: string | null; mode: string } }> = [];
    renderHook(() =>
      useAgentSurfaceReveal('ws-1', (pane, file) => calls.push({ pane, file })),
    );

    spy.emit(toolEvent('ws-1', 'Write', { file_path: 'src/a.ts' }));
    // A different file re-reveals (panel tracks the agent's current file)…
    spy.emit(toolEvent('ws-1', 'Edit', { file_path: 'src/b.ts' }));
    // …but the same file again does not.
    spy.emit(toolEvent('ws-1', 'Edit', { file_path: 'src/b.ts' }));

    expect(calls).toEqual([
      { pane: 'file', file: { path: 'src/a.ts', mode: 'content' } },
      { pane: 'file', file: { path: 'src/b.ts', mode: 'diff' } },
    ]);
  });

  it('ignores a file write with no file_path', () => {
    const spy = installFakeApi();
    const revealed: string[] = [];
    renderHook(() => useAgentSurfaceReveal('ws-1', (p) => revealed.push(p)));
    spy.emit(toolEvent('ws-1', 'Write', {}));
    expect(revealed).toEqual([]);
  });
});
