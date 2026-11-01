/**
 * The workspace step says where the agent works if the person skips it: the
 * workspace the app already started in (the built-in Moxxy one on a first run).
 * Creating one names it after the folder, says when it failed, and does not
 * hold the person while the agent for it is still starting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { WorkspaceStep } from './WorkspaceStep';

afterEach(() => {
  __setApiOverride(null);
});

const moxxy: Desk = {
  id: 'moxxy',
  name: 'Moxxy',
  cwd: '/Users/me/Moxxy',
  color: '#ec4899',
  createdAt: 1,
  sessions: [],
  activeSessionId: null,
};

const picked: Desk = { ...moxxy, id: 'work', name: 'moxxy', cwd: 'C:\\Users\\me\\Desktop\\moxxy' };

/** The desktop host as the step reaches it over IPC; `handlers` replace its answers. */
function host(handlers: Record<string, (args: unknown) => Promise<unknown>> = {}): void {
  __setApiOverride({
    invoke: async (cmd: string, args: unknown) => {
      const handler = handlers[cmd];
      if (handler) return handler(args);
      if (cmd === 'desks.list') return { desks: [moxxy], activeId: 'moxxy' };
      if (cmd === 'desks.pickFolder') return picked.cwd;
      return undefined;
    },
    subscribe: () => () => undefined,
  } as never);
}

async function pickFolder(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Choose a folder/ }));
  await screen.findByRole('button', { name: /Desktop\\moxxy/ });
}

describe('WorkspaceStep', () => {
  it('names the workspace and folder a skip keeps working in', async () => {
    host();
    render(<WorkspaceStep onNext={() => undefined} onBack={() => undefined} />);

    expect(
      await screen.findByText('Skip, and I’ll work in “Moxxy” at /Users/me/Moxxy. You can pick another folder later.'),
    ).toBeInTheDocument();
  });

  it('names a workspace after the Windows folder picked, not its whole path', async () => {
    host();
    render(<WorkspaceStep onNext={() => undefined} onBack={() => undefined} />);

    await pickFolder();

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('moxxy');
  });

  it('moves on without waiting for the agent of the new workspace to start', async () => {
    const onNext = vi.fn();
    const created: unknown[] = [];
    host({
      'desks.create': async (args) => {
        created.push(args);
        return picked;
      },
      // The host answers only once the agent is up, minutes later on a first run.
      'desks.setActive': () => new Promise(() => undefined),
    });
    render(<WorkspaceStep onNext={onNext} onBack={() => undefined} />);
    await pickFolder();

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(created).toEqual([{ name: 'moxxy', cwd: 'C:\\Users\\me\\Desktop\\moxxy' }]);
  });

  it('says why a workspace could not be created and stays on the step', async () => {
    const onNext = vi.fn();
    host({ 'desks.create': async () => Promise.reject(new Error('That folder does not exist.')) });
    render(<WorkspaceStep onNext={onNext} onBack={() => undefined} />);
    await pickFolder();

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That folder does not exist.');
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  });
});
