import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import { ScheduleStore } from '@moxxy/plugin-scheduler';
import { setActiveBus } from './shared';
import { registerSchedulerHandlers } from './scheduler';
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

async function tempStore(): Promise<{ readonly dir: string; readonly file: string; readonly store: ScheduleStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-scheduler-ipc-'));
  temps.push(dir);
  const file = path.join(dir, 'schedules.json');
  return { dir, file, store: new ScheduleStore({ file }) };
}

describe('scheduler IPC handlers', () => {
  it('lists fresh schedules even when another scheduler store changed the file', async () => {
    const { file, store } = await tempStore();
    const externalStore = new ScheduleStore({ file });
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSchedulerHandlers(store);

    const first = await store.create({
      name: 'morning-summary',
      prompt: 'Write the morning summary',
      cron: '0 8 * * *',
    });
    const listHandler = handlers.get('scheduler.list');
    assertDefined(listHandler, 'scheduler.list handler');
    expect(await listHandler()).toEqual([
      expect.objectContaining({ id: first.id, name: 'morning-summary' }),
    ]);

    const second = await externalStore.create({
      name: 'evening-summary',
      prompt: 'Write the evening summary',
      cron: '0 18 * * *',
    });

    expect(await listHandler()).toEqual([
      expect.objectContaining({ id: first.id, name: 'morning-summary' }),
      expect.objectContaining({ id: second.id, name: 'evening-summary' }),
    ]);
  });

  it('toggles and deletes existing schedules by id', async () => {
    const { store } = await tempStore();
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSchedulerHandlers(store);
    const created = await store.create({
      name: 'weekly-recap',
      prompt: 'Write the recap',
      cron: '0 9 * * 1',
    });

    const setEnabledHandler = handlers.get('scheduler.setEnabled');
    assertDefined(setEnabledHandler, 'scheduler.setEnabled handler');
    await expect(setEnabledHandler({
      id: created.id,
      enabled: false,
    })).resolves.toEqual(expect.objectContaining({ id: created.id, enabled: false }));
    const deleteHandler = handlers.get('scheduler.delete');
    assertDefined(deleteHandler, 'scheduler.delete handler');
    await expect(deleteHandler({ id: created.id })).resolves.toEqual({ deleted: true });
    const listHandler = handlers.get('scheduler.list');
    assertDefined(listHandler, 'scheduler.list handler');
    await expect(listHandler()).resolves.toEqual([]);
  });
});
