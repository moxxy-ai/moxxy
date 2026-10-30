import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __resetDesksStoreForTests, __resetSchedulerStoreForTests, __setApiOverride } from '@moxxy/client-core';
import type { DesksOverview, MoxxyApi, ScheduleCreateInput, ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { SchedulesPanel } from './SchedulesPanel';

/**
 * The Schedules screen end to end in the renderer: real hooks, real form rules.
 * Only the IPC call to the main process is stood in for, by a small in-memory
 * host that keeps the schedules it is sent.
 */

const base: Omit<ScheduleSummary, 'id' | 'name'> = {
  enabled: true, cron: '0 9 * * *', runAt: null, timeZone: null, channel: null, model: null,
  promptPreview: 'p', source: 'manual', skillName: null, workflowName: null, createdAt: 1,
  lastRunAt: null, lastResult: null, lastError: null, nextFireAt: null, nextFireIso: null,
};

function installHost(initial: ScheduleSummary[], desks: DesksOverview = { desks: [], activeId: null }) {
  let schedules = [...initial];
  const created: ScheduleCreateInput[] = [];
  const invoke = async (cmd: string, args?: unknown): Promise<unknown> => {
    switch (cmd) {
      case 'scheduler.list':
        return schedules;
      case 'scheduler.create': {
        const input = args as ScheduleCreateInput;
        created.push(input);
        const summary: ScheduleSummary = { ...base, id: `id-${input.name}`, name: input.name, cron: input.cron ?? null };
        schedules = [...schedules, summary];
        return summary;
      }
      case 'scheduler.delete':
        schedules = schedules.filter((s) => s.id !== (args as { id: string }).id);
        return { deleted: true };
      case 'desks.list':
        return desks;
      default:
        return null;
    }
  };
  __setApiOverride({ invoke, subscribe: () => () => undefined } as unknown as MoxxyApi);
  return { created };
}

afterEach(() => {
  __setApiOverride(null);
  __resetSchedulerStoreForTests();
  __resetDesksStoreForTests();
});

describe('SchedulesPanel', () => {
  it('lists schedules as cards that say their repeat in words', async () => {
    installHost([{ ...base, id: 'a', name: 'morning-news', cron: '*/30 * * * *' }]);
    render(<SchedulesPanel />);

    const row = await screen.findByTestId('schedule-row-a');
    expect(within(row).getByText('morning-news')).toBeTruthy();
    expect(within(row).getByText('Every 30 minutes')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Disable morning-news' })).toBeTruthy();
  });

  it('offers a first schedule when there is none', async () => {
    installHost([]);
    render(<SchedulesPanel />);
    expect(await screen.findByText('No schedules yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create a schedule' }));
    expect(screen.getByRole('dialog', { name: 'New schedule' })).toBeTruthy();
  });

  it('creates a schedule from the form and shows it in the list', async () => {
    const host = installHost([]);
    const user = userEvent.setup();
    render(<SchedulesPanel />);
    await screen.findByText('No schedules yet');

    await user.click(screen.getAllByRole('button', { name: 'New schedule' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByLabelText('What should Moxxy do?'), 'Continue the book');
    await user.selectOptions(within(dialog).getByLabelText('How often'), 'minutes');
    expect(within(dialog).getByText('Runs every 30 minutes.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(host.created).toEqual([{ name: 'continue-the-book', prompt: 'Continue the book', cron: '*/30 * * * *' }]);
    expect(await screen.findByTestId('schedule-row-id-continue-the-book')).toBeTruthy();
  });

  it('runs a new schedule in the chat the person is in, unless they pick another', async () => {
    const chat = { id: 's-book', name: 'Book chat', createdAt: 1 };
    const host = installHost([], {
      desks: [{ id: 'd1', name: 'Novel', cwd: '/n', color: 'blue', createdAt: 1, sessions: [chat], activeSessionId: 's-book' }],
      activeId: 'd1',
    });
    const user = userEvent.setup();
    render(<SchedulesPanel />);
    await screen.findByText('No schedules yet');

    await user.click(screen.getAllByRole('button', { name: 'New schedule' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'New schedule' });
    expect((within(dialog).getByLabelText('Runs in') as HTMLSelectElement).value).toBe('s-book');
    await user.type(within(dialog).getByLabelText('What should Moxxy do?'), 'Continue the book');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(host.created).toHaveLength(1));
    expect(host.created[0]).toMatchObject({ name: 'continue-the-book', targetSessionId: 's-book' });
  });

  it('says what is missing instead of saving an empty schedule', async () => {
    const host = installHost([]);
    const user = userEvent.setup();
    render(<SchedulesPanel />);
    await screen.findByText('No schedules yet');

    await user.click(screen.getAllByRole('button', { name: 'New schedule' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'New schedule' });
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    expect(within(dialog).getByText('Say what Moxxy should do.')).toBeTruthy();
    expect(host.created).toEqual([]);
  });

  it('deletes a schedule only after asking', async () => {
    installHost([{ ...base, id: 'a', name: 'morning-news' }]);
    const user = userEvent.setup();
    render(<SchedulesPanel />);
    const row = await screen.findByTestId('schedule-row-a');

    await user.click(within(row).getByRole('button', { name: 'Delete morning-news' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete schedule?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByTestId('schedule-row-a')).toBeNull());
  });
});
