/**
 * OAuthSignIn stale-closure regression: the login subscriptions live for the
 * component's lifetime ([]-dep), but onSignedIn must be read from a ref so a
 * caller that passes a fresh inline arrow every render gets the CURRENT
 * callback fired on completion — not the one captured at mount.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { OAuthSignIn } from './OAuthSignIn';

afterEach(() => {
  __setApiOverride(null);
  vi.restoreAllMocks();
});

type Handler = (payload: unknown) => void;

function fakeApi(): { api: MoxxyApi; emit: (event: string, payload: unknown) => void } {
  const handlers = new Map<string, Set<Handler>>();
  const api = {
    invoke: vi.fn(async () => undefined),
    subscribe: (event: string, fn: Handler) => {
      const set = handlers.get(event) ?? new Set();
      set.add(fn);
      handlers.set(event, set);
      return () => set.delete(fn);
    },
  } as unknown as MoxxyApi;
  const emit = (event: string, payload: unknown): void => {
    for (const fn of handlers.get(event) ?? []) fn(payload);
  };
  return { api, emit };
}

describe('OAuthSignIn', () => {
  it('fires the latest onSignedIn, not the one captured at mount', async () => {
    const { api, emit } = fakeApi();
    __setApiOverride(api);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('login-1' as `${string}-${string}-${string}-${string}-${string}`);

    const v1 = vi.fn();
    const v2 = vi.fn();
    const { rerender } = render(<OAuthSignIn provider="codex" onSignedIn={v1} />);

    // Start the login (sets loginIdRef to 'login-1').
    fireEvent.click(screen.getByText('Sign in with codex'));
    await waitFor(() => expect((api.invoke as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'provider.login.start',
      { loginId: 'login-1', provider: 'codex' },
    ));

    // Caller re-renders with a fresh handler (the real callers pass an inline arrow).
    rerender(<OAuthSignIn provider="codex" onSignedIn={v2} />);

    // Login completes successfully.
    act(() => emit('provider.login.done', { loginId: 'login-1', code: 0 }));

    expect(v2).toHaveBeenCalledTimes(1);
    expect(v1).not.toHaveBeenCalled();
  });
});
