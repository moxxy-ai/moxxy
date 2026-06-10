/**
 * Tests for the workflows builder panel. Locks down:
 *   1. The list renders rows and "+ New" / per-row "Edit" open the builder.
 *   2. The palette adds a node that renders on the canvas.
 *   3. Editing a field in the inspector updates the node.
 *   4. Loop body assignment wires a step into the loop.
 *   5. Save runs validateDraft → save through the IPC.
 *   6. A validation error decorates the node + surfaces in the inspector.
 *
 * The shared model is unit-tested in @moxxy/workflows-builder; here we assert
 * the wiring (render ↔ reducer ↔ IPC) the panel is responsible for.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, WorkflowSummary } from '@moxxy/desktop-ipc-contract';
import { WorkflowsPanel } from './WorkflowsPanel';

interface Spy {
  readonly invokes: Array<{ cmd: string; args: unknown }>;
}

function installApi(opts: {
  list?: WorkflowSummary[];
  validate?: (yaml: string) => { ok: boolean; errors: string[] };
} = {}): Spy {
  const invokes: Array<{ cmd: string; args: unknown }> = [];
  const list = opts.list ?? [];
  const validate = opts.validate ?? (() => ({ ok: true, errors: [] }));
  __setApiOverride({
    invoke: ((cmd: string, args: unknown) => {
      invokes.push({ cmd, args });
      if (cmd === 'workflows.list') return Promise.resolve(list);
      if (cmd === 'workflows.validateDraft') {
        return Promise.resolve(validate((args as { yaml: string }).yaml));
      }
      if (cmd === 'workflows.save') return Promise.resolve({ name: 'demo', scope: 'user', path: '/x.yaml' });
      if (cmd === 'workflows.getRun') return Promise.resolve(null);
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => {}) as never,
  } as MoxxyApi);
  return { invokes };
}

afterEach(() => __setApiOverride(null));

const sample: WorkflowSummary = {
  name: 'daily-summary',
  description: 'Rolls up the inbox',
  enabled: true,
  scope: 'global',
  steps: 3,
  triggers: 'on-demand',
};

describe('WorkflowsPanel — list mode', () => {
  it('renders rows and opens the builder via Edit', async () => {
    installApi({ list: [sample] });
    render(<WorkflowsPanel />);
    await screen.findByTestId('workflow-row-daily-summary');
    fireEvent.click(screen.getByTestId('edit-workflow-daily-summary'));
    expect(await screen.findByTestId('workflow-canvas')).toBeInTheDocument();
  });

  it('+ New opens an empty builder', async () => {
    installApi({ list: [] });
    render(<WorkflowsPanel />);
    fireEvent.click(await screen.findByTestId('new-workflow'));
    expect(await screen.findByTestId('workflow-canvas')).toBeInTheDocument();
  });
});

describe('WorkflowsPanel — builder', () => {
  async function openBuilder(spyOpts?: Parameters<typeof installApi>[0]): Promise<Spy> {
    const spy = installApi({ list: [], ...spyOpts });
    render(<WorkflowsPanel />);
    fireEvent.click(await screen.findByTestId('new-workflow'));
    await screen.findByTestId('workflow-canvas');
    return spy;
  }

  it('adds a node from the palette and renders it', async () => {
    await openBuilder();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    expect(await screen.findByTestId('wf-node-prompt')).toBeInTheDocument();
  });

  it('edits a node field through the inspector', async () => {
    await openBuilder();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    // The node auto-selects on add → inspector is shown.
    const action = await screen.findByTestId('field-action');
    fireEvent.change(action, { target: { value: 'do the thing' } });
    expect((action as HTMLTextAreaElement).value).toBe('do the thing');
  });

  it('assigns a step into a loop body', async () => {
    await openBuilder();
    fireEvent.click(screen.getByTestId('palette-add-loop'));
    await screen.findByTestId('wf-node-loop');
    fireEvent.click(screen.getByTestId('palette-add-bridge'));
    await screen.findByTestId('wf-node-bridge');
    // Re-select the loop to edit its body.
    fireEvent.pointerDown(screen.getByTestId('wf-node-loop'));
    const body = await screen.findByTestId('loop-body');
    const checkbox = within(body).getByRole('checkbox');
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('saves through validateDraft → save', async () => {
    const spy = await openBuilder();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    fireEvent.change(await screen.findByTestId('field-action'), { target: { value: 'go' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('builder-save'));
    });
    await waitFor(() => expect(spy.invokes.some((i) => i.cmd === 'workflows.save')).toBe(true));
    expect(spy.invokes.some((i) => i.cmd === 'workflows.validateDraft')).toBe(true);
  });

  it('shows a validation error on the offending node', async () => {
    await openBuilder({
      validate: () => ({ ok: false, errors: ['steps: step "prompt" needs unknown step "ghost"'] }),
    });
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    // The debounced live validation maps the error onto the node + inspector.
    const errors = await screen.findByTestId('node-errors', undefined, { timeout: 2000 });
    expect(errors.textContent).toContain('ghost');
  });
});
