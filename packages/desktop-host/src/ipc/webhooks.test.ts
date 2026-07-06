import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import { WebhookStore } from '@moxxy/plugin-webhooks';
import { setActiveBus } from './shared';
import { registerWebhookHandlers } from './webhooks';
import { assertDefined } from '@moxxy/sdk';

type Handler = (...args: unknown[]) => Promise<unknown>;

function fakeBus(): { readonly bus: CommandBus; readonly handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as unknown as CommandBus;
  return { bus, handlers };
}

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempStore(): Promise<{ readonly file: string; readonly store: WebhookStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-webhooks-ipc-'));
  temps.push(dir);
  const file = path.join(dir, 'webhooks.json');
  return { file, store: new WebhookStore({ file }) };
}

/** Minimal valid trigger input (no verification, no filters). */
function triggerInput(name: string) {
  return {
    name,
    prompt: `Handle a ${name} delivery`,
    allowedTools: [],
    verification: { type: 'none' as const },
    filters: { include: [], exclude: [] },
  };
}

describe('webhooks IPC handlers', () => {
  it('lists fresh triggers even when another store wrote the file', async () => {
    const { file, store } = await tempStore();
    const externalStore = new WebhookStore({ file });
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerWebhookHandlers(store);

    const first = await store.create(triggerInput('github-push'));
    const listHandler = handlers.get('webhooks.list');
    assertDefined(listHandler, 'webhooks.list handler');
    expect(await listHandler()).toEqual([
      expect.objectContaining({ id: first.id, name: 'github-push', localPath: `/webhook/${first.id}` }),
    ]);

    const second = await externalStore.create(triggerInput('stripe-charge'));
    expect(await listHandler()).toEqual([
      expect.objectContaining({ id: first.id, name: 'github-push' }),
      expect.objectContaining({ id: second.id, name: 'stripe-charge' }),
    ]);
  });

  it('redacts verification secrets in the listed summary', async () => {
    const { store } = await tempStore();
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerWebhookHandlers(store);
    await store.create({
      ...triggerInput('secret-hook'),
      verification: { type: 'bearer', secret: 'super-secret-token' },
    });

    const listHandler = handlers.get('webhooks.list');
    assertDefined(listHandler, 'webhooks.list handler');
    const listed = (await listHandler()) as Array<Record<string, unknown>>;
    expect(JSON.stringify(listed)).not.toContain('super-secret-token');
  });

  it('toggles and deletes existing triggers by id', async () => {
    const { store } = await tempStore();
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerWebhookHandlers(store);
    const created = await store.create(triggerInput('weekly-recap'));

    const setEnabledHandler = handlers.get('webhooks.setEnabled');
    assertDefined(setEnabledHandler, 'webhooks.setEnabled handler');
    await expect(
      setEnabledHandler({ id: created.id, enabled: false }),
    ).resolves.toEqual(expect.objectContaining({ id: created.id, enabled: false }));
    const deleteHandler = handlers.get('webhooks.delete');
    assertDefined(deleteHandler, 'webhooks.delete handler');
    await expect(deleteHandler({ id: created.id })).resolves.toEqual({
      deleted: true,
    });
    const listHandler = handlers.get('webhooks.list');
    assertDefined(listHandler, 'webhooks.list handler');
    await expect(listHandler()).resolves.toEqual([]);
  });
});
