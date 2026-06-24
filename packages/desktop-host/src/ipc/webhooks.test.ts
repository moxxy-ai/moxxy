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
    expect(await handlers.get('webhooks.list')!()).toEqual([
      expect.objectContaining({ id: first.id, name: 'github-push', localPath: `/webhook/${first.id}` }),
    ]);

    const second = await externalStore.create(triggerInput('stripe-charge'));
    expect(await handlers.get('webhooks.list')!()).toEqual([
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

    const listed = (await handlers.get('webhooks.list')!()) as Array<Record<string, unknown>>;
    expect(JSON.stringify(listed)).not.toContain('super-secret-token');
  });

  it('toggles and deletes existing triggers by id', async () => {
    const { store } = await tempStore();
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerWebhookHandlers(store);
    const created = await store.create(triggerInput('weekly-recap'));

    await expect(
      handlers.get('webhooks.setEnabled')!({ id: created.id, enabled: false }),
    ).resolves.toEqual(expect.objectContaining({ id: created.id, enabled: false }));
    await expect(handlers.get('webhooks.delete')!({ id: created.id })).resolves.toEqual({
      deleted: true,
    });
    await expect(handlers.get('webhooks.list')!()).resolves.toEqual([]);
  });
});
