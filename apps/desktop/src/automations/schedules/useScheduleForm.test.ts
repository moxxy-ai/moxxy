import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ScheduleCreateInput, ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import type { ScheduleCreateOutcome } from '@moxxy/client-core';
import { useScheduleForm } from './useScheduleForm';

const now = new Date(2026, 9, 28, 18, 34).getTime();
const saved = { id: 's1', name: 'continue-the-book' } as ScheduleSummary;

/** `create` stands in for the IPC call (the host boundary); it records what it was sent. */
function setup(outcome: ScheduleCreateOutcome = { ok: true, schedule: saved }) {
  const sent: ScheduleCreateInput[] = [];
  const create = async (input: ScheduleCreateInput): Promise<ScheduleCreateOutcome> => {
    sent.push(input);
    return outcome;
  };
  const onCreated = vi.fn();
  const hook = renderHook(() => useScheduleForm({ create, onCreated, now: () => now }));
  return { hook, sent, onCreated };
}

describe('useScheduleForm', () => {
  it('names the schedule after its prompt until the person names it', () => {
    const { hook } = setup();
    act(() => hook.result.current.set({ prompt: 'Continue the book from STATUS' }));
    expect(hook.result.current.values.name).toBe('continue-the-book-from-status');

    act(() => hook.result.current.set({ name: 'Book Night' }));
    act(() => hook.result.current.set({ prompt: 'Something else' }));
    expect(hook.result.current.values.name).toBe('book-night');

    // Clearing the name hands it back to the prompt.
    act(() => hook.result.current.set({ name: '' }));
    act(() => hook.result.current.set({ prompt: 'Read the news' }));
    expect(hook.result.current.values.name).toBe('read-the-news');
  });

  it('shows a problem only once its field was left, or a save was tried', async () => {
    const { hook, sent } = setup();
    expect(hook.result.current.problems).toEqual({});

    act(() => hook.result.current.touch('prompt'));
    expect(hook.result.current.problems).toEqual({ prompt: 'Say what Moxxy should do.' });

    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.problems).toEqual({
      prompt: 'Say what Moxxy should do.',
      name: 'Give it a name.',
    });
    expect(sent).toEqual([]);
  });

  it('saves what the form says and hands the saved schedule on', async () => {
    const { hook, sent, onCreated } = setup();
    act(() => hook.result.current.set({ prompt: 'Continue the book', repeat: 'minutes', everyMinutes: 30 }));
    expect(hook.result.current.summary).toBe('Runs every 30 minutes.');

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(sent).toEqual([{ name: 'continue-the-book', prompt: 'Continue the book', cron: '*/30 * * * *' }]);
    expect(onCreated).toHaveBeenCalledWith(saved);
  });

  it('keeps the form open with the host’s reason, as a sentence, when it refuses', async () => {
    const { hook, onCreated } = setup({ ok: false, error: 'schedules file is busy' });
    act(() => hook.result.current.set({ prompt: 'p' }));

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(hook.result.current.error).toBe('Schedules file is busy.');
    expect(hook.result.current.busy).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();

    act(() => hook.result.current.set({ prompt: 'q' }));
    expect(hook.result.current.error).toBeNull();
  });

  it('shows a refusal about one field under that field, until the person changes the form', async () => {
    const { hook } = setup({ ok: false, error: 'this moment already passed at 2026-10-28T17:30:00.000Z' });
    act(() => hook.result.current.set({ prompt: 'p', repeat: 'once' }));

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(hook.result.current.problems.at).toBe('This time has already passed. Pick a later one.');
    expect(hook.result.current.error).toBeNull();

    act(() => hook.result.current.set({ at: '2026-10-30T09:00' }));
    expect(hook.result.current.problems.at).toBeUndefined();
  });
});
