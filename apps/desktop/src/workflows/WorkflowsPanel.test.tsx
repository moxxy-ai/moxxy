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

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, createEvent } from '@testing-library/react';
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

describe('WorkflowsPanel — human-in-the-loop paused reply', () => {
  /** Install an api whose `subscribe('runner.event', …)` handler is captured so
   *  the test can push a `workflow_paused` plugin event, and whose
   *  `workflows.resume` invocation is spied. */
  function installPausedApi(): {
    invokes: Array<{ cmd: string; args: unknown }>;
    emit: (event: unknown) => void;
  } {
    const invokes: Array<{ cmd: string; args: unknown }> = [];
    let runnerHandler: ((payload: { event: unknown }) => void) | null = null;
    __setApiOverride({
      invoke: ((cmd: string, args: unknown) => {
        invokes.push({ cmd, args });
        if (cmd === 'workflows.list') return Promise.resolve([]);
        if (cmd === 'workflows.resume') {
          return Promise.resolve({ ok: true, output: 'done', steps: [{ id: 'ask', status: 'completed' }] });
        }
        return Promise.resolve(undefined);
      }) as never,
      subscribe: ((channel: string, handler: (payload: { event: unknown }) => void) => {
        if (channel === 'runner.event') runnerHandler = handler;
        return () => {
          runnerHandler = null;
        };
      }) as never,
    } as MoxxyApi);
    return { invokes, emit: (event) => runnerHandler?.({ event }) };
  }

  const pausedEvent = {
    type: 'plugin_event',
    subtype: 'workflow_paused',
    pluginId: 'workflows',
    payload: {
      runId: 'run-1',
      stepId: 'ask',
      workflow: 'draft-with-approval',
      label: 'Approve or tweak',
      prompt: 'Reply with "ship it" to approve.',
    },
  };

  it('surfaces a paused-workflow card and dispatches workflows.resume on reply', async () => {
    const spy = installPausedApi();
    render(<WorkflowsPanel />);
    // Let the list settle; no card before the pause event.
    await screen.findByText('Workflows');
    expect(screen.queryByTestId('paused-workflow-run-1')).not.toBeInTheDocument();
    // The runner reports a pause → the card appears with the prompt.
    await act(async () => {
      spy.emit(pausedEvent);
    });
    const card = await screen.findByTestId('paused-workflow-run-1');
    expect(card.textContent).toContain('draft-with-approval');
    expect(card.textContent).toContain('ship it');

    // The operator types a reply and submits → workflows.resume(runId, reply).
    fireEvent.change(screen.getByTestId('paused-reply-run-1'), { target: { value: 'ship it' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('paused-send-run-1'));
    });
    await waitFor(() =>
      expect(
        spy.invokes.some(
          (i) =>
            i.cmd === 'workflows.resume' &&
            (i.args as { runId: string; reply: string }).runId === 'run-1' &&
            (i.args as { reply: string }).reply === 'ship it',
        ),
      ).toBe(true),
    );
    // Card clears once resumed.
    await waitFor(() => expect(screen.queryByTestId('paused-workflow-run-1')).not.toBeInTheDocument());
  });

  it('clears the paused card when the run resumes via a workflow_resumed event', async () => {
    const spy = installPausedApi();
    render(<WorkflowsPanel />);
    await act(async () => {
      spy.emit(pausedEvent);
    });
    await screen.findByTestId('paused-workflow-run-1');
    await act(async () => {
      spy.emit({ type: 'plugin_event', subtype: 'workflow_resumed', pluginId: 'workflows', payload: { runId: 'run-1', stepId: 'ask' } });
    });
    await waitFor(() => expect(screen.queryByTestId('paused-workflow-run-1')).not.toBeInTheDocument());
  });
});

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

/**
 * Drag-to-connect on the canvas. Two jsdom quirks shape these tests:
 *   1. getBoundingClientRect is all-zeros + scroll is 0, so surface coords ==
 *      clientX/clientY and node hit-testing is purely positional — we lay nodes
 *      out by dragging them to known spots, then assert the derived edges.
 *   2. jsdom's PointerEvent drops clientX/clientY, so `firePointer` builds the
 *      event and forces the coordinates on before dispatch.
 */
type PointerType = 'pointerDown' | 'pointerMove' | 'pointerUp';
function firePointer(el: Element, type: PointerType, x: number, y: number, pointerId = 1): void {
  const ev = createEvent[type](el, { clientX: x, clientY: y, pointerId });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  fireEvent(el, ev);
}

describe('WorkflowsPanel — canvas drag-to-connect', () => {
  async function openWith(spyOpts?: Parameters<typeof installApi>[0]): Promise<Spy> {
    const spy = installApi({ list: [], ...spyOpts });
    render(<WorkflowsPanel />);
    fireEvent.click(await screen.findByTestId('new-workflow'));
    await screen.findByTestId('workflow-canvas');
    return spy;
  }

  /** Body-drag a node from its current origin to (x, y). */
  function moveNodeTo(id: string, fromX: number, fromY: number, x: number, y: number): void {
    const canvas = screen.getByTestId('workflow-canvas');
    firePointer(screen.getByTestId(`wf-node-${id}`), 'pointerDown', fromX, fromY);
    firePointer(canvas, 'pointerMove', x, y);
    firePointer(canvas, 'pointerUp', x, y);
  }

  /** Drag from a source handle to a drop point on the canvas. */
  function dragConnect(handleTestId: string, fromX: number, fromY: number, toX: number, toY: number): void {
    const canvas = screen.getByTestId('workflow-canvas');
    firePointer(screen.getByTestId(handleTestId), 'pointerDown', fromX, fromY, 2);
    firePointer(canvas, 'pointerMove', toX, toY, 2);
    firePointer(canvas, 'pointerUp', toX, toY, 2);
  }

  // First two prompt steps land at (40,40) and (80,80). Spread B clear of A.
  async function twoNodes(): Promise<Spy> {
    const spy = await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // -> id "prompt" @ (40,40)
    await screen.findByTestId('wf-node-prompt');
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // -> id "prompt_2" @ (80,80)
    await screen.findByTestId('wf-node-prompt_2');
    moveNodeTo('prompt_2', 80, 80, 400, 300); // B card now spans x∈[400,600], y∈[300,388]
    return spy;
  }

  it('dragging A.output → over B dispatches connect ⇒ B.needs=[A] (a needs edge appears)', async () => {
    await twoNodes();
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 460, 320);
    // connect-needs(from=prompt, to=prompt_2) derives this edge.
    expect(await screen.findByTestId('wf-edge-needs:prompt->prompt_2')).toBeInTheDocument();
  });

  it('pointerup on empty canvas cancels — no edge, no stuck temp line', async () => {
    await twoNodes();
    const canvas = screen.getByTestId('workflow-canvas');
    firePointer(screen.getByTestId('wf-handle-prompt-needs-right'), 'pointerDown', 240, 84, 2);
    firePointer(canvas, 'pointerMove', 700, 500, 2);
    expect(screen.getByTestId('temp-connection')).toBeInTheDocument(); // line is live mid-drag
    firePointer(canvas, 'pointerUp', 700, 500, 2);
    expect(screen.queryByTestId('temp-connection')).not.toBeInTheDocument(); // cleared
    expect(screen.queryByTestId('wf-edge-needs:prompt->prompt_2')).not.toBeInTheDocument();
  });

  it('clicking an edge ✕ dispatches disconnect (the edge disappears)', async () => {
    await twoNodes();
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 460, 320); // wire A→B
    await screen.findByTestId('wf-edge-needs:prompt->prompt_2');
    // Then remove it via the midpoint ✕.
    fireEvent.click(screen.getByTestId('wf-edge-remove-needs:prompt->prompt_2'));
    await waitFor(() =>
      expect(screen.queryByTestId('wf-edge-needs:prompt->prompt_2')).not.toBeInTheDocument(),
    );
  });

  it('a self-connect (drop the output back on its own card) is a no-op', async () => {
    await twoNodes();
    // Drop back inside A's own card (A spans x∈[40,240], y∈[40,128]).
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 120, 80);
    expect(screen.queryByTestId('wf-edge-needs:prompt->prompt')).not.toBeInTheDocument();
  });

  it('refuses a drag that would create a cycle (surfaces a rejection)', async () => {
    await twoNodes();
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 460, 320); // A→B
    await screen.findByTestId('wf-edge-needs:prompt->prompt_2');
    // Now drag B's output back onto A — that B→A would close A→B→A.
    dragConnect('wf-handle-prompt_2-needs-right', 600, 344, 120, 80);
    expect(await screen.findByTestId('connect-reject')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-edge-needs:prompt_2->prompt')).not.toBeInTheDocument();
  });

  it('dropping a step onto a loop card BODY region wires it into the loop body', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-loop')); // id "loop" @ (40,40)
    await screen.findByTestId('wf-node-loop');
    fireEvent.click(screen.getByTestId('palette-add-bridge')); // id "bridge" @ (80,80)
    await screen.findByTestId('wf-node-bridge');
    moveNodeTo('loop', 40, 40, 400, 300); // loop spans x∈[400,600], y∈[300,388]; body region y≥344
    // Drop the bridge output on the loop's LOWER (body) half (y > 344).
    dragConnect('wf-handle-bridge-needs-right', 280, 124, 460, 370);
    // setLoopBody derives a loop-body edge loop -> bridge.
    expect(await screen.findByTestId('wf-edge-body:loop->bridge')).toBeInTheDocument();
  });

  it("dragging a condition's 'then' handle to a target sets the branch", async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-condition')); // id "condition" @ (40,40)
    await screen.findByTestId('wf-node-condition');
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // id "prompt" @ (80,80)
    await screen.findByTestId('wf-node-prompt');
    moveNodeTo('prompt', 80, 80, 400, 300); // target spans x∈[400,600], y∈[300,388]
    dragConnect('wf-handle-condition-then-right', 240, 70, 460, 320);
    // setBranchTargets(condition, 'then', ['prompt']) derives a then edge.
    expect(await screen.findByTestId('wf-edge-then:condition->prompt')).toBeInTheDocument();
  });
});
