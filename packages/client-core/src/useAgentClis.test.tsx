/**
 * useAgentClis — installing, updating and checking the agent CLIs from a
 * window, through the IPC surface (the fake api shim stands in for the host).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SESSION_INFO_REFRESH_EVENT, type AgentCliProgress, type AgentCliRunResult, type MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { configurePlatform } from './platform.js';
import { __setApiOverride } from './transport.js';
import { useAgentClis } from './useAgentClis.js';

afterEach(() => {
  __setApiOverride(null);
  configurePlatform({});
});

/** The events the hook sends on the platform's bus, in order. */
function recordBus(): string[] {
  const sent: string[] = [];
  configurePlatform({ eventBus: { on: () => () => undefined, emit: (event) => void sent.push(event) } });
  return sent;
}

function host() {
  const calls: Array<[string, unknown]> = [];
  let progress: ((p: AgentCliProgress) => void) | null = null;
  let finish: ((r: AgentCliRunResult) => void) | null = null;
  const api = {
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      if (cmd === 'agents.run') return new Promise<AgentCliRunResult>((resolve) => (finish = resolve));
      return undefined;
    },
    subscribe: (event: string, fn: (p: AgentCliProgress) => void) => {
      if (event === 'agents.progress') progress = fn;
      return () => {
        progress = null;
      };
    },
  };
  __setApiOverride(api as unknown as MoxxyApi);
  return {
    calls,
    emit: (p: AgentCliProgress) => progress?.(p),
    finish: (r: AgentCliRunResult) => finish?.(r),
  };
}

describe('useAgentClis', () => {
  it('follows an install line by line until it ends', async () => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());

    let done: Promise<AgentCliRunResult> | undefined;
    act(() => {
      done = result.current.run('opencode', 'install');
    });
    expect(result.current.jobs.opencode).toMatchObject({ action: 'install', running: true });
    act(() => h.emit({ provider: 'opencode', action: 'install', line: '#### 40.0%', fraction: 0.4 }));
    expect(result.current.jobs.opencode).toMatchObject({ line: '#### 40.0%', fraction: 0.4 });
    act(() => h.emit({ provider: 'codex-agent', action: 'install', line: 'elsewhere' }));
    expect(result.current.jobs.opencode?.line).toBe('#### 40.0%');

    await act(async () => {
      h.finish({ ok: true, message: 'Installed' });
      await done;
    });
    expect(result.current.jobs.opencode).toBeUndefined();
    expect(h.calls).toContainEqual(['agents.run', { provider: 'opencode', action: 'install' }]);
  });

  it('keeps why it failed', async () => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());

    await act(async () => {
      const done = result.current.run('codex-agent', 'update');
      h.finish({ ok: false, message: 'Wait until the running turns end' });
      await done;
    });

    expect(result.current.jobs['codex-agent']).toMatchObject({ running: false, error: 'Wait until the running turns end' });
  });

  it('checks every agent again, saying so while it runs', async () => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());

    await act(async () => {
      await result.current.check();
    });

    expect(h.calls).toContainEqual(['agents.check', undefined]);
    await waitFor(() => expect(result.current.checking).toBe(false));
  });

  // With no runner up yet (a first run), no runner says its state changed, so the views read it again themselves.
  it('has every view read the agents again once an install ends, failed or not', async () => {
    const h = host();
    const sent = recordBus();
    const { result } = renderHook(() => useAgentClis());

    await act(async () => {
      const done = result.current.run('codex-agent', 'install');
      h.finish({ ok: true, message: 'Installed' });
      await done;
    });
    await act(async () => {
      const done = result.current.run('opencode', 'install');
      h.finish({ ok: false, message: 'npm failed' });
      await done;
    });

    expect(sent).toEqual([SESSION_INFO_REFRESH_EVENT, SESSION_INFO_REFRESH_EVENT]);
  });

  it('has every view read the agents again after checking them', async () => {
    host();
    const sent = recordBus();
    const { result } = renderHook(() => useAgentClis());

    await act(async () => {
      await result.current.check();
    });

    expect(sent).toEqual([SESSION_INFO_REFRESH_EVENT]);
  });
});
