/**
 * useOnboarding tests — the auto-refresh path (mount / phase change) calls
 * `void refresh()` with no .catch, so refresh() must not let an onboarding.status
 * or probeNode rejection escape as an unhandled rejection. It settles each probe
 * independently and flips loading back to false regardless.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { useOnboarding } from './useOnboarding.js';

afterEach(() => {
  __setApiOverride(null);
});

describe('useOnboarding.refresh', () => {
  it('does not produce an unhandled rejection when onboarding.status rejects on mount', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'onboarding.status') throw new Error('status IPC down');
      if (cmd === 'onboarding.probeNode') return { ok: true } as never;
      return undefined;
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const { result } = renderHook(() => useOnboarding());

    // loading must settle to false even though one probe rejected.
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The succeeding probe still populated its slice.
    expect(result.current.node).toEqual({ ok: true });
    // Give any stray microtask-rejection a tick to surface.
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();

    process.off('unhandledRejection', unhandled);
  });
});
