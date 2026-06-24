import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { ScheduleStore, describeScheduleEntry } from '@moxxy/plugin-scheduler';
import type { DeskStore } from '../desks';
import { buildSessionNameResolver, handle, type SessionNameResolver } from './shared';

const defaultStore = new ScheduleStore();

export function registerSchedulerHandlers(
  store: ScheduleStore = defaultStore,
  desks?: DeskStore,
): void {
  handle('scheduler.list', async () => {
    store.invalidate();
    const [entries, resolveName] = await Promise.all([store.list(), buildSessionNameResolver(desks)]);
    return entries.map((e) => toScheduleSummary(e, resolveName));
  });

  handle('scheduler.setEnabled', async ({ id, enabled }) => {
    store.invalidate();
    const updated = await store.update(id, { enabled });
    return updated ? toScheduleSummary(updated, await buildSessionNameResolver(desks)) : null;
  });

  handle('scheduler.setTargetSession', async ({ id, sessionId }) => {
    store.invalidate();
    // `ownerSessionId` is the stored routing key the poller owner-gate honors,
    // so reassigning here re-homes which runner fires the schedule.
    const updated = await store.update(id, { ownerSessionId: sessionId ?? undefined });
    return updated ? toScheduleSummary(updated, await buildSessionNameResolver(desks)) : null;
  });

  handle('scheduler.delete', async ({ id }) => {
    store.invalidate();
    return { deleted: await store.delete(id) };
  });
}

function toScheduleSummary(
  entry: Parameters<typeof describeScheduleEntry>[0],
  resolveName: SessionNameResolver,
): ScheduleSummary {
  const described = describeScheduleEntry(entry) as unknown as ScheduleSummary;
  return { ...described, targetSessionName: resolveName(described.targetSessionId) };
}
