/**
 * The workspace step says where the agent works if the person skips it: the
 * workspace the app already started in (the built-in Moxxy one on a first run).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('WorkspaceStep', () => {
  it('names the workspace and folder a skip keeps working in', async () => {
    __setApiOverride({
      invoke: async (cmd: string) => (cmd === 'desks.list' ? { desks: [moxxy], activeId: 'moxxy' } : undefined),
      subscribe: () => () => undefined,
    } as never);
    render(<WorkspaceStep onNext={() => undefined} onBack={() => undefined} />);

    expect(
      await screen.findByText('Skip, and I’ll work in “Moxxy” at /Users/me/Moxxy. You can pick another folder later.'),
    ).toBeInTheDocument();
  });
});
