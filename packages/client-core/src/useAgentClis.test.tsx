/**
 * useAgentClis — installing, updating and checking the agent CLIs from a
 * window, through the IPC surface (the fake api shim stands in for the host).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentCliProgress, AgentCliRunResult, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { __resetAgentClisForTests, useAgentClis } from './useAgentClis.js';

afterEach(() => {
  __resetAgentClisForTests();
  __setApiOverride(null);
});

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

  it('keeps a running update when the screen that started it closes, for the next one to show', async () => {
    const h = host();
    const first = renderHook(() => useAgentClis());
    let done: Promise<AgentCliRunResult> | undefined;
    act(() => {
      done = first.result.current.run('codex-agent', 'update');
    });
    first.unmount();

    const second = renderHook(() => useAgentClis());
    expect(second.result.current.jobs['codex-agent']).toMatchObject({ running: true });

    act(() => h.emit({ provider: 'codex-agent', action: 'update', line: 'Downloading', fraction: 0.5 }));
    expect(second.result.current.jobs['codex-agent']).toMatchObject({ line: 'Downloading', fraction: 0.5 });
    await act(async () => {
      h.finish({ ok: true, message: 'Done', outcome: 'updated' });
      await done;
    });
    expect(second.result.current.jobs['codex-agent']).toBeUndefined();
  });

  it('starts one update at a time', async () => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());
    let done: Promise<AgentCliRunResult> | undefined;
    act(() => {
      done = result.current.run('codex-agent', 'update');
    });

    let second: AgentCliRunResult | undefined;
    await act(async () => {
      second = await result.current.run('codex-agent', 'update');
    });

    expect(second?.ok).toBe(false);
    expect(h.calls.filter(([cmd]) => cmd === 'agents.run')).toHaveLength(1);
    await act(async () => {
      h.finish({ ok: true, message: 'Done' });
      await done;
    });
  });

  it.each(['unchanged', 'unverified'] as const)('keeps a note, not an error, for an update that ended %s', async (outcome) => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());

    await act(async () => {
      const done = result.current.run('codex-agent', 'update');
      h.finish({ ok: true, message: 'Codex is still 0.166.0.', outcome });
      await done;
    });

    expect(result.current.jobs['codex-agent']).toMatchObject({ running: false, error: null, note: 'Codex is still 0.166.0.' });
  });

  it('offers the install after an update took the copy with it', async () => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());

    await act(async () => {
      const done = result.current.run('opencode', 'update');
      h.finish({ ok: false, message: 'OpenCode no longer runs', outcome: 'gone' });
      await done;
    });

    expect(result.current.jobs.opencode).toMatchObject({ action: 'update', retry: 'install', error: 'OpenCode no longer runs' });
  });

  it('forgets how a job ended once it is closed, and a note once checked again', async () => {
    const h = host();
    const { result } = renderHook(() => useAgentClis());
    await act(async () => {
      const done = result.current.run('opencode', 'update');
      h.finish({ ok: false, message: 'No' });
      await done;
    });
    act(() => result.current.close('opencode'));
    expect(result.current.jobs.opencode).toBeUndefined();

    await act(async () => {
      const done = result.current.run('opencode', 'update');
      h.finish({ ok: true, message: 'Still', outcome: 'unchanged' });
      await done;
    });
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.jobs.opencode).toBeUndefined();
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
});
