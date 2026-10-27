import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { __resetToastsForTests, getToasts } from '../notices/toast-store';
import { useProviderMigrationNotice } from './useProviderMigrationNotice';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

// Only the Electron IPC boundary is replaced; the hook and notice store are real.
afterEach(() => { cleanup(); __setApiOverride(null); __resetToastsForTests(); });
function oldProfile(): void {
  __setApiOverride({ invoke: async () => ({ activeProvider: 'openai-codex' }), subscribe: () => () => undefined } as never);
}
const connected = (activeProvider: string | null): ConnectionPhase => ({ phase: 'connected', socket: 'test', sessionId: 'test', activeProvider, activeMode: 'default' });
it('explains the retired sign-in in provider recovery', async () => {
  oldProfile();
  const { result } = renderHook(() => useProviderMigrationNotice(connected(null)));
  await waitFor(() => expect(result.current).toMatch(/ChatGPT sign-in was removed/));
  expect(result.current).toMatch(/Codex|OpenAI API key/);
});
it('explains the automatic move to Codex once it is connected', async () => {
  oldProfile();
  const { rerender } = renderHook(({ phase }) => useProviderMigrationNotice(phase), { initialProps: { phase: connected('codex-agent') } });
  await waitFor(() => expect(getToasts()).toHaveLength(1));
  expect(getToasts()[0]?.body).toMatch(/ChatGPT — Codex agent/);
  rerender({ phase: connected('codex-agent') });
  expect(getToasts()).toHaveLength(1);
});
