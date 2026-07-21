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
  it('reports successful CLI readiness and fires the latest onSignedIn', async () => {
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

    expect(await screen.findByText('Signed in to codex.')).toBeTruthy();
    expect(v2).toHaveBeenCalledTimes(1);
    expect(v1).not.toHaveBeenCalled();
  });

  it('shows missing-binary diagnostics without exposing credential input', async () => {
    const { api, emit } = fakeApi();
    __setApiOverride(api);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('login-missing' as `${string}-${string}-${string}-${string}-${string}`);
    render(<OAuthSignIn provider="claude-code" />);

    fireEvent.click(screen.getByText('Sign in with claude-code'));
    act(() => emit('provider.login.output', {
      loginId: 'login-missing',
      text: 'Claude CLI executable not found: claude. Install Claude Code or set CLAUDE_CODE_EXECUTABLE.\n',
    }));
    act(() => emit('provider.login.done', { loginId: 'login-missing', code: 1 }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in did not complete');
    expect(screen.getByText(/Claude CLI executable not found/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('can cancel an in-progress Claude CLI sign-in and reports cancellation', async () => {
    const { api } = fakeApi();
    __setApiOverride(api);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('login-cancel' as `${string}-${string}-${string}-${string}-${string}`);
    render(<OAuthSignIn provider="claude-code" />);

    fireEvent.click(screen.getByText('Sign in with claude-code'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));

    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith(
      'provider.login.cancel', { loginId: 'login-cancel' },
    ));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in cancelled.');
  });

  it('reports a failed CLI sign-in and preserves diagnostic output', async () => {
    const { api, emit } = fakeApi();
    __setApiOverride(api);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('login-failed' as `${string}-${string}-${string}-${string}-${string}`);
    render(<OAuthSignIn provider="claude-code" />);

    fireEvent.click(screen.getByText('Sign in with claude-code'));
    act(() => emit('provider.login.output', { loginId: 'login-failed', text: 'Claude CLI login failed.\n' }));
    act(() => emit('provider.login.done', { loginId: 'login-failed', code: 7 }));

    expect(await screen.findByRole('alert')).toHaveTextContent('exit 7');
    expect(screen.getByText('Claude CLI login failed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
