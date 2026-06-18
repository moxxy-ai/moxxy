/**
 * useContextUsage tests — drive the hook through the fake api shim + the live
 * chatStore usage fold and assert the savings/hit-rate arithmetic, the
 * provider/model context-window resolution (with fallbacks), and the clamped
 * fraction. These mirror the sdk token-accounting math the meter depends on.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MoxxyEvent, SessionInfo } from '@moxxy/sdk';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { chatStore } from './chatStore.js';
import { useContextUsage } from './useContextUsage.js';

function fakeApi(info: SessionInfo | null): MoxxyApi {
  return {
    invoke: (async (cmd: string) => {
      if (cmd === 'session.info') return info;
      throw new Error(`unexpected ${cmd}`);
    }) as unknown as MoxxyApi['invoke'],
    subscribe: () => () => {},
  };
}

function info(
  providers: Array<{ name: string; models: Array<{ id: string; contextWindow?: number }> }>,
  activeProvider: string | null,
): SessionInfo {
  return {
    sessionId: 's',
    cwd: '/',
    activeProvider,
    providers: providers.map((p) => ({
      name: p.name,
      models: p.models.map((m) => ({ id: m.id, contextWindow: m.contextWindow })),
    })),
  } as unknown as SessionInfo;
}

let seq = 0;
function providerResponse(usage: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    seq,
    ts: seq,
    turnId: 'T1',
    sessionId: 'S',
    source: 'model',
    type: 'provider_response',
    provider: 'p',
    model: 'm',
    ...usage,
  } as unknown as MoxxyEvent;
}

let nextWs = 0;
function ws(): string {
  nextWs += 1;
  return `ctx-ws-${nextWs}`;
}

afterEach(() => {
  __setApiOverride(null);
});

describe('useContextUsage summary arithmetic', () => {
  it('computes totalPrompt, cacheHitRate and savedRatio from folded usage', async () => {
    const id = ws();
    __setApiOverride(fakeApi(null));
    chatStore.dispatch(id, {
      type: 'event',
      event: providerResponse({
        inputTokens: 100,
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
        outputTokens: 40,
      }),
    });

    const { result } = renderHook(() => useContextUsage(id));
    const s = result.current.summary;
    // totalPrompt = input + cacheRead + cacheCreation
    expect(s.totalPrompt).toBe(500);
    expect(s.totalOutput).toBe(40);
    // cacheHitRate = cacheRead / totalPrompt
    expect(s.cacheHitRate).toBeCloseTo(300 / 500, 6);
    // billedInputEq = 100 + 300*0.1 + 100*1.25 = 255; savedRatio = 1 - 255/500
    expect(s.savedRatio).toBeCloseTo(1 - 255 / 500, 6);
    expect(result.current.hasData).toBe(true);
  });

  it('reports zeroed ratios and no data before any usage', () => {
    const id = ws();
    __setApiOverride(fakeApi(null));
    const { result } = renderHook(() => useContextUsage(id));
    expect(result.current.summary.totalPrompt).toBe(0);
    expect(result.current.summary.cacheHitRate).toBe(0);
    expect(result.current.summary.savedRatio).toBe(0);
    expect(result.current.hasData).toBe(false);
    expect(result.current.contextTokens).toBeNull();
  });
});

describe('useContextUsage context window resolution', () => {
  it('resolves the active provider + model contextWindow', async () => {
    const id = ws();
    chatStore.setModel(id, 'big');
    __setApiOverride(
      fakeApi(
        info(
          [
            { name: 'other', models: [{ id: 'x', contextWindow: 1 }] },
            { name: 'p', models: [{ id: 'big', contextWindow: 200_000 }] },
          ],
          'p',
        ),
      ),
    );
    const { result } = renderHook(() => useContextUsage(id));
    await waitFor(() => expect(result.current.contextWindow).toBe(200_000));
  });

  it('falls back to the first provider/first model when no match', async () => {
    const id = ws();
    chatStore.setModel(id, 'unknown-model');
    __setApiOverride(
      fakeApi(
        info([{ name: 'p', models: [{ id: 'first', contextWindow: 128_000 }] }], 'missing-active'),
      ),
    );
    const { result } = renderHook(() => useContextUsage(id));
    // activeProvider has no match → providers[0]; model has no match → models[0].
    await waitFor(() => expect(result.current.contextWindow).toBe(128_000));
  });

  it('returns null window when info is absent', () => {
    const id = ws();
    __setApiOverride(fakeApi(null));
    const { result } = renderHook(() => useContextUsage(id));
    expect(result.current.contextWindow).toBeNull();
    expect(result.current.fraction).toBeNull();
  });
});

describe('useContextUsage fraction', () => {
  it('clamps latestPrompt/contextWindow into [0,1]', async () => {
    const id = ws();
    chatStore.setModel(id, 'm1');
    chatStore.dispatch(id, { type: 'event', event: providerResponse({ inputTokens: 50_000 }) });
    __setApiOverride(
      fakeApi(info([{ name: 'p', models: [{ id: 'm1', contextWindow: 100_000 }] }], 'p')),
    );
    const { result } = renderHook(() => useContextUsage(id));
    await waitFor(() => expect(result.current.contextWindow).toBe(100_000));
    expect(result.current.fraction).toBeCloseTo(0.5, 6);
  });
});
