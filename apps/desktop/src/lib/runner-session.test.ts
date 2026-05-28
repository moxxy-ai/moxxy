import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRunnerSession } from './runner-session';
import { mockTauri } from '@/__mocks__/tauri';

vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));

describe('useRunnerSession', () => {
  beforeEach(() => {
    mockTauri.reset();
    mockTauri.respond('runner_ready', () => false);
  });

  it('starts not-ready with no blocks', () => {
    const { result } = renderHook(() => useRunnerSession());
    expect(result.current.ready).toBe(false);
    expect(result.current.blocks).toEqual([]);
    expect(result.current.activeTurnId).toBeNull();
  });

  it('flips ready when runner.ready event arrives', async () => {
    const { result } = renderHook(() => useRunnerSession());
    act(() => mockTauri.emit('runner.ready', true));
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('records a user block when send() succeeds', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', (args) => {
      expect(args?.args).toEqual({ prompt: 'hello' });
      return 'T-1';
    });
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.activeTurnId).toBe('T-1');
    expect(result.current.blocks).toEqual([
      expect.objectContaining({ kind: 'user', text: 'hello' }),
    ]);
  });

  it('coalesces chunk events into a single streaming assistant block', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', { kind: 'chunk', text: 'Hel' });
      mockTauri.emit('runner.event', { kind: 'chunk', text: 'lo!' });
    });
    const assistant = result.current.blocks.find((b) => b.kind === 'assistant');
    expect(assistant).toMatchObject({
      kind: 'assistant',
      text: 'Hello!',
      streaming: true,
    });
  });

  it('marks the assistant block done on turn.complete', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', { kind: 'chunk', text: 'done' });
      mockTauri.emit('runner.turn.complete', { turnId: 'T-1' });
    });
    const assistant = result.current.blocks.find((b) => b.kind === 'assistant');
    expect(assistant).toMatchObject({ kind: 'assistant', streaming: false });
    expect(result.current.activeTurnId).toBeNull();
  });

  it('appends a tool block for tool events', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', {
        kind: 'tool',
        toolCall: { name: 'grep', status: 'running' },
      });
    });
    expect(result.current.blocks).toContainEqual(
      expect.objectContaining({ kind: 'tool', name: 'grep', status: 'running' }),
    );
  });

  it('appends a system block for system events', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', {
        kind: 'system',
        text: 'switched to deep-research',
      });
    });
    expect(result.current.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'system',
        text: 'switched to deep-research',
      }),
    );
  });

  it('appends an error block for error events', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', {
        kind: 'error',
        message: 'rate-limited',
      });
    });
    expect(result.current.blocks).toContainEqual(
      expect.objectContaining({ kind: 'error', text: 'rate-limited' }),
    );
  });

  it('updates an existing running tool to done in place', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', {
        kind: 'tool',
        toolCall: { name: 'grep', status: 'running' },
      });
      mockTauri.emit('runner.event', {
        kind: 'tool',
        toolCall: { name: 'grep', status: 'done', summary: '12 matches' },
      });
    });
    const tools = result.current.blocks.filter((b) => b.kind === 'tool');
    expect(tools.length).toBe(1);
    expect(tools[0]).toMatchObject({
      kind: 'tool',
      name: 'grep',
      status: 'done',
      summary: '12 matches',
    });
  });

  it('keeps separate running tool calls with the same name distinct', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      mockTauri.emit('runner.event', {
        kind: 'tool',
        toolCall: { name: 'grep', status: 'running' },
      });
      mockTauri.emit('runner.event', {
        kind: 'tool',
        toolCall: { name: 'grep', status: 'done' },
      });
      mockTauri.emit('runner.event', {
        kind: 'tool',
        toolCall: { name: 'grep', status: 'running' },
      });
    });
    const tools = result.current.blocks.filter((b) => b.kind === 'tool');
    expect(tools.length).toBe(2);
    expect(tools.map((t) => t.kind === 'tool' && t.status)).toEqual([
      'done',
      'running',
    ]);
  });

  it('ignores unknown event kinds without crashing', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-1');
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    const before = result.current.blocks.length;
    act(() => {
      mockTauri.emit('runner.event', { kind: 'something-new', payload: 42 });
    });
    expect(result.current.blocks.length).toBe(before);
  });

  it('captures errors from runner.error events', async () => {
    const { result } = renderHook(() => useRunnerSession());
    act(() => mockTauri.emit('runner.error', 'boom'));
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('rejects send() when the underlying command throws', async () => {
    mockTauri.respond('runner_ready', () => false);
    mockTauri.respond('run_turn', () => {
      throw new Error('runner not connected');
    });
    const { result } = renderHook(() => useRunnerSession());
    await expect(result.current.send('hi')).rejects.toThrow('runner not connected');
    expect(result.current.activeTurnId).toBeNull();
  });

  it('abort() is a no-op when no turn is active', async () => {
    const { result } = renderHook(() => useRunnerSession());
    await result.current.abort();
    // Should not have called abort_turn at all.
    expect(mockTauri.calls.find((c) => c.cmd === 'abort_turn')).toBeUndefined();
  });

  it('abort() forwards the active turn id', async () => {
    mockTauri.respond('runner_ready', () => true);
    mockTauri.respond('run_turn', () => 'T-9');
    mockTauri.respond('abort_turn', (args) => {
      expect(args).toEqual({ turnId: 'T-9' });
      return null;
    });
    const { result } = renderHook(() => useRunnerSession());
    await act(async () => {
      await result.current.send('hi');
    });
    await act(async () => {
      await result.current.abort();
    });
    expect(mockTauri.calls.find((c) => c.cmd === 'abort_turn')).toBeDefined();
  });
});
