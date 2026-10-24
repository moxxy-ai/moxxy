import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { configurePlatform } from './platform.js';
import { __setApiOverride } from './transport.js';
import { useReadAloud } from './useReadAloud.js';

afterEach(() => {
  configurePlatform({});
  __setApiOverride(null);
});

function setup(plan: { partChars: number } | null) {
  const invoke = vi.fn(async (channel: string, _payload?: unknown) => {
    if (channel === 'session.readAloudPlan') return plan;
    if (channel === 'session.synthesize') return new Promise(() => undefined);
    return undefined;
  });
  configurePlatform({
    tts: {
      isSupported: () => true,
      speak: vi.fn(),
      cancel: vi.fn(),
      playClip: vi.fn(() => ({ stop: vi.fn() })),
    },
  });
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  const synthesized = () => invoke.mock.calls
    .filter(([channel]) => channel === 'session.synthesize')
    .map(([, payload]) => payload as { text: string; cache?: boolean });
  return { invoke, synthesized };
}

const MESSAGE = 'First sentence. Second sentence. Third sentence.';

describe('useReadAloud', () => {
  it('sends the whole message at once, asking to keep it, when Gemini speaks', async () => {
    const { synthesized } = setup({ partChars: 3_000 });
    const { result } = renderHook(() => useReadAloud(MESSAGE, 'ws-1'));

    act(() => result.current.toggle());

    await waitFor(() => expect(synthesized()).toHaveLength(1));
    expect(synthesized()[0]).toMatchObject({
      text: MESSAGE,
      cache: true,
    });
  });

  it('reads sentence by sentence, keeping nothing, for every other synthesizer', async () => {
    const { synthesized } = setup(null);
    const { result } = renderHook(() => useReadAloud(MESSAGE, 'ws-1'));

    act(() => result.current.toggle());

    await waitFor(() => expect(synthesized().length).toBeGreaterThan(1));
    expect(synthesized()[0]).toEqual(expect.objectContaining({ text: 'First sentence.' }));
    expect(synthesized().some((payload) => payload.cache)).toBe(false);
  });

  it('starts once when clicked twice before the plan arrives', async () => {
    const { invoke, synthesized } = setup({ partChars: 3_000 });
    const { result } = renderHook(() => useReadAloud(MESSAGE, 'ws-1'));

    act(() => {
      result.current.toggle();
      result.current.toggle();
    });

    await waitFor(() => expect(synthesized()).toHaveLength(1));
    expect(invoke.mock.calls.filter(([channel]) => channel === 'session.readAloudPlan')).toHaveLength(1);
  });
});
