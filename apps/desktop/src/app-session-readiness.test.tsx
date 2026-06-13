import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useSessionInfoReady } from './app-session-readiness';
import type { SessionInfo } from './chat/agent-picker/types';

const connectedPhase = {
  phase: 'connected',
  socket: '/tmp/fresh.sock',
  sessionId: 'fresh-session',
  activeProvider: 'openai-codex',
  activeMode: 'default',
} as const;

const readyInfo: SessionInfo = {
  providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5' }] }],
  modes: ['default'],
  activeProvider: 'openai-codex',
  activeMode: 'default',
  activeModeBadge: null,
};

function installInfoSequence(values: ReadonlyArray<SessionInfo | null>) {
  let index = 0;
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd !== 'session.info') throw new Error(`unexpected ${cmd}`);
    const value = values[Math.min(index, values.length - 1)] ?? null;
    index += 1;
    return value;
  });
  __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
  return invoke;
}

afterEach(() => {
  vi.useRealTimers();
  __setApiOverride(null);
});

describe('useSessionInfoReady', () => {
  it('keeps a connected cold-start session unready until session.info returns providers and modes', async () => {
    vi.useFakeTimers();
    const invoke = installInfoSequence([null, readyInfo]);
    const { result } = renderHook(() =>
      useSessionInfoReady('fresh-session', connectedPhase),
    );

    expect(result.current).toBe(false);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
