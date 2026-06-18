/**
 * askStore tests — the optimistic respond() must NOT silently strand the runner
 * if the ask.respond IPC fails. The runner parks blocked on the ask until the
 * response lands, so a swallowed transport/handler rejection would wedge the
 * turn with no way to re-answer; respond() re-surfaces the ask on failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskRequest, AskResponse, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { askStore } from './askStore.js';

function ask(requestId: string): AskRequest {
  return { requestId, workspaceId: 'ws1', kind: 'permission' };
}

const ALLOW: AskResponse = { mode: 'allow' };

afterEach(() => {
  // Clear any leftover asks via a resolving transport, then reset.
  __setApiOverride({ invoke: async () => undefined, subscribe: () => () => {} } as unknown as MoxxyApi);
  for (const a of [...askStore.getAll()]) askStore.respond(a.requestId, ALLOW);
  __setApiOverride(null);
});

describe('askStore.respond', () => {
  it('drops the ask optimistically on a successful round-trip', async () => {
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    askStore.add(ask('r1'));
    expect(askStore.getAll().some((a) => a.requestId === 'r1')).toBe(true);

    askStore.respond('r1', ALLOW);
    // Dropped immediately (optimistic).
    expect(askStore.getAll().some((a) => a.requestId === 'r1')).toBe(false);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('ask.respond', { requestId: 'r1', response: ALLOW });
    // Still gone after the IPC resolves.
    expect(askStore.getAll().some((a) => a.requestId === 'r1')).toBe(false);
  });

  it('re-surfaces the ask when the ask.respond IPC rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invoke = vi.fn(async () => {
      throw new Error('transport down');
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    askStore.add(ask('r2'));

    askStore.respond('r2', ALLOW);
    // Optimistically dropped first…
    expect(askStore.getAll().some((a) => a.requestId === 'r2')).toBe(false);
    // …then re-inserted once the rejection lands so the user can retry.
    await Promise.resolve();
    await Promise.resolve();
    expect(askStore.getAll().some((a) => a.requestId === 'r2')).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
