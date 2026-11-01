/**
 * The notice follows the setup the host reports: asked once, then pushed as it
 * moves. The host is reached through its IPC surface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { AppSetupState } from '@moxxy/desktop-ipc-contract';
import { useSetupNotice } from './useSetupNotice';

afterEach(() => {
  __setApiOverride(null);
});

const running: AppSetupState = {
  reason: 'install',
  phase: 'running',
  steps: [{ id: 'extensions', status: 'running' }],
  notes: [],
};

describe('useSetupNotice', () => {
  it('shows while the host sets up and goes once it is done', async () => {
    let push: ((state: AppSetupState) => void) | null = null;
    __setApiOverride({
      invoke: async (cmd: string) => (cmd === 'app.setup' ? running : undefined),
      subscribe: (event: string, fn: (state: AppSetupState) => void) => {
        if (event === 'app.setup.changed') push = fn;
        return () => undefined;
      },
    } as never);

    const { result } = renderHook(() => useSetupNotice());

    await waitFor(() => expect(result.current).toMatch(/^Moxxy is still setting up: Extensions and tools/));
    act(() => push?.({ ...running, phase: 'done', steps: [{ id: 'extensions', status: 'done' }] }));
    expect(result.current).toBeNull();
  });
});
