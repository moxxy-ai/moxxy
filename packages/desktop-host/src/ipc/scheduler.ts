import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { ScheduleStore, describeScheduleEntry } from '@moxxy/plugin-scheduler';
import { handle } from './shared';

const defaultStore = new ScheduleStore();

export function registerSchedulerHandlers(store: ScheduleStore = defaultStore): void {
  handle('scheduler.list', async () => {
    store.invalidate();
    const entries = await store.list();
    return entries.map(toScheduleSummary);
  });

  handle('scheduler.setEnabled', async ({ id, enabled }) => {
    store.invalidate();
    const updated = await store.update(id, { enabled });
    return updated ? toScheduleSummary(updated) : null;
  });

  handle('scheduler.delete', async ({ id }) => {
    store.invalidate();
    return { deleted: await store.delete(id) };
  });
}

function toScheduleSummary(entry: Parameters<typeof describeScheduleEntry>[0]): ScheduleSummary {
  return describeScheduleEntry(entry) as unknown as ScheduleSummary;
}
