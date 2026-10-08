import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setApiOverride, connectionStore } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { WorkflowApprovals } from './WorkflowApprovals';

/**
 * A request to approve is the only reason the section exists: with nothing
 * waiting it must not stand above the list as a heading over an empty line.
 */

const WORKSPACE = 'w-approvals';

// The IPC boundary is the one thing replaced: there is no Electron main here.
function installApi(items: unknown[]): void {
  __setApiOverride({
    invoke: ((cmd: string) =>
      Promise.resolve(cmd === 'workflows.approvals' ? items : undefined)) as never,
    subscribe: (() => () => {}) as never,
  } as MoxxyApi);
}

afterEach(() => {
  cleanup();
  act(() => connectionStore.setActive(null));
  __setApiOverride(null);
});

describe('WorkflowApprovals', () => {
  it('draws nothing while no workflow is waiting on the person', () => {
    installApi([]);
    const { container } = render(<WorkflowApprovals />);
    expect(container).toBeEmptyDOMElement();
  });

  it('heads the requests once one is waiting', async () => {
    installApi([
      {
        id: '3f2b1c9e-5a47-4d1e-9b0a-6c2d8e7f1a34',
        workflowId: 'wf',
        workflowName: 'Daily report',
        revision: 'r1',
        runId: 'run1',
        tool: 'Write',
        input: { path: 'report.txt' },
        createdAt: 1,
        status: 'pending',
      },
    ]);
    act(() => {
      connectionStore.setActive(WORKSPACE);
      // Only a connected runner is asked what is waiting.
      connectionStore.setSnapshot(WORKSPACE, {
        phase: { phase: 'connected', socket: '/tmp/moxxy.sock', sessionId: 's-1', activeProvider: null, activeMode: null },
        cliPath: null,
        attempts: 0,
        log: [],
      });
    });
    render(<WorkflowApprovals />);
    expect(await screen.findByText('Daily report')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
  });
});
