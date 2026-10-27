import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { __resetToastsForTests, getToasts } from '../notices/toast-store';
import { useProviderMigrationNotice } from './useProviderMigrationNotice';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

// Only the Electron IPC boundary is replaced; the hook and notice store are real.
afterEach(() => { cleanup(); __setApiOverride(null); __resetToastsForTests(); });
function profile(status: { activeProvider: string | null; providerMigration: { from: string; to: string } | null }): string[] {
  const calls: string[] = [];
  __setApiOverride({
    invoke: async (command: string) => { calls.push(command); return command === 'onboarding.status' ? status : undefined; },
    subscribe: () => () => undefined,
  } as never);
  return calls;
}
function oldProfile(): string[] {
  return profile({ activeProvider: 'openai-codex', providerMigration: null });
}
const connected = (activeProvider: string | null): ConnectionPhase => ({ phase: 'connected', socket: 'test', sessionId: 'test', activeProvider, activeMode: 'default' });
it('explains the retired sign-in in provider recovery', async () => {
  oldProfile();
  const { result } = renderHook(() => useProviderMigrationNotice(connected(null), { toast: false }));
  await waitFor(() => expect(result.current).toMatch(/ChatGPT sign-in was removed/));
  expect(result.current).toMatch(/Codex|OpenAI API key/);
});
it('explains the automatic move to Codex once it is connected', async () => {
  const calls = oldProfile();
  const { rerender } = renderHook(({ phase }) => useProviderMigrationNotice(phase, { toast: true }), { initialProps: { phase: connected('codex-agent') } });
  await waitFor(() => expect(getToasts()).toHaveLength(1));
  expect(getToasts()[0]?.body).toMatch(/ChatGPT — Codex agent/);
  rerender({ phase: connected('codex-agent') });
  expect(getToasts()).toHaveLength(1);
  await waitFor(() => expect(calls).toContain('onboarding.dismissProviderMigration'));
});
it('says it once when the runner already saved the move before the window opened, and forgets it', async () => {
  const calls = profile({ activeProvider: 'codex-agent', providerMigration: { from: 'openai-codex', to: 'codex-agent' } });
  renderHook(() => useProviderMigrationNotice(connected('codex-agent'), { toast: true }));
  await waitFor(() => expect(getToasts()).toHaveLength(1));
  expect(getToasts()[0]?.title).toBe('ChatGPT sign-in was removed');
  await waitFor(() => expect(calls).toContain('onboarding.dismissProviderMigration'));
});
it('stays quiet on a profile that never used the ChatGPT sign-in', async () => {
  const calls = profile({ activeProvider: 'claude-code', providerMigration: null });
  const { result } = renderHook(() => useProviderMigrationNotice(connected('claude-code'), { toast: true }));
  await waitFor(() => expect(calls).toContain('onboarding.status'));
  expect(result.current).toBeNull();
  expect(getToasts()).toHaveLength(0);
  expect(calls).not.toContain('onboarding.dismissProviderMigration');
});
it('keeps the notice for later where toasts cannot be seen (setup and recovery screens)', async () => {
  const calls = profile({ activeProvider: 'codex-agent', providerMigration: { from: 'openai-codex', to: 'codex-agent' } });
  renderHook(() => useProviderMigrationNotice(connected('codex-agent'), { toast: false }));
  await waitFor(() => expect(calls).toContain('onboarding.status'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(getToasts()).toHaveLength(0);
  expect(calls).not.toContain('onboarding.dismissProviderMigration');
});
