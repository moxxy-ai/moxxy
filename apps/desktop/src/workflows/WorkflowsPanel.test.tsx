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
  /** Partial `session.info` payload (skills/tools) for the action pickers;
   *  omitted → session.info resolves null (no session) like the real handler. */
  sessionInfo?: { skills?: Array<{ id: string; name: string }>; tools?: Array<{ name: string; description: string }> };
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
      if (cmd === 'session.info') {
        return Promise.resolve(
          opts.sessionInfo
            ? { skills: opts.sessionInfo.skills ?? [], tools: opts.sessionInfo.tools ?? [] }
            : null,
        );
      }
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

describe('WorkflowsPanel — generate with AI', () => {
  it('"Generate with AI" opens the agent-task modal with the workflow framing', async () => {
    installApi({ list: [] });
    render(<WorkflowsPanel />);
    fireEvent.click(await screen.findByTestId('generate-workflow'));
    expect(screen.getByText('Generate workflow with AI')).toBeInTheDocument();
    expect(screen.getByText(/describe the workflow/i)).toBeInTheDocument();
    // No active workspace in this harness — the shared modal's guard must
    // surface and its Generate CTA stays disabled (same guard as MCP/providers).
    expect(screen.getByText(/no active workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('Cancel closes the modal without entering the builder', async () => {
    installApi({ list: [] });
    render(<WorkflowsPanel />);
    fireEvent.click(await screen.findByTestId('generate-workflow'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Generate workflow with AI')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('workflow-canvas')).not.toBeInTheDocument();
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

  it('offers a dropdown of the session\'s skills on a skill node', async () => {
    await openBuilder({
      sessionInfo: {
        skills: [
          { id: 'sum', name: 'summarize-inbox' },
          { id: 'rep', name: 'weekly-report' },
        ],
      },
    });
    fireEvent.click(screen.getByTestId('palette-add-skill'));
    await screen.findByTestId('wf-node-skill');
    const picker = await screen.findByTestId('field-action');
    await waitFor(() => expect(picker.tagName).toBe('SELECT'));
    const options = within(picker).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('summarize-inbox');
    expect(options).toContain('weekly-report');
    fireEvent.change(picker, { target: { value: 'weekly-report' } });
    expect((picker as HTMLSelectElement).value).toBe('weekly-report');
  });

  it('offers a dropdown of the session\'s tools on a tool node, with the description shown', async () => {
    await openBuilder({
      sessionInfo: { tools: [{ name: 'web_fetch', description: 'Fetch a URL over HTTP.' }] },
    });
    fireEvent.click(screen.getByTestId('palette-add-tool'));
    await screen.findByTestId('wf-node-tool');
    const picker = await screen.findByTestId('field-action');
    await waitFor(() => expect(picker.tagName).toBe('SELECT'));
    fireEvent.change(picker, { target: { value: 'web_fetch' } });
    expect((await screen.findByTestId('action-description')).textContent).toContain('Fetch a URL');
  });

  it('renders a placeholder option until a skill is picked', async () => {
    await openBuilder({ sessionInfo: { skills: [{ id: 'a', name: 'present-skill' }] } });
    fireEvent.click(screen.getByTestId('palette-add-skill'));
    await screen.findByTestId('wf-node-skill');
    const picker = await screen.findByTestId('field-action');
    await waitFor(() => expect(picker.tagName).toBe('SELECT'));
    expect(within(picker).getAllByRole('option')[0]!.textContent).toContain('Select a skill');
  });

  it('keeps a saved-but-uninstalled skill selectable instead of rewriting it', async () => {
    // A saved workflow references a skill that's no longer installed: the
    // picker must surface it as "(not installed)" rather than silently
    // swapping the value to something else.
    const yaml = [
      'name: uses-ghost',
      'description: refs a removed skill',
      'steps:',
      '  - id: run_skill',
      '    skill: ghost-skill',
    ].join('\n');
    __setApiOverride({
      invoke: ((cmd: string) => {
        if (cmd === 'workflows.list') return Promise.resolve([{ ...sample, name: 'uses-ghost' }]);
        if (cmd === 'workflows.getRun') return Promise.resolve({ name: 'uses-ghost', yaml });
        if (cmd === 'workflows.validateDraft') return Promise.resolve({ ok: true, errors: [] });
        if (cmd === 'session.info') {
          return Promise.resolve({ skills: [{ id: 'a', name: 'present-skill' }], tools: [] });
        }
        return Promise.resolve(undefined);
      }) as never,
      subscribe: (() => () => {}) as never,
    } as MoxxyApi);
    render(<WorkflowsPanel />);
    await screen.findByTestId('workflow-row-uses-ghost');
    fireEvent.click(screen.getByTestId('edit-workflow-uses-ghost'));
    await screen.findByTestId('workflow-canvas');
    fireEvent.pointerDown(await screen.findByTestId('wf-node-run_skill'));
    const picker = await screen.findByTestId('field-action');
    await waitFor(() => expect(picker.tagName).toBe('SELECT'));
    expect((picker as HTMLSelectElement).value).toBe('ghost-skill');
    const labels = within(picker).getAllByRole('option').map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('ghost-skill') && l.includes('not installed'))).toBe(true);
    expect(labels).toContain('present-skill');
  });

  it('says so when there are no skills (and no tools) instead of a bare field', async () => {
    await openBuilder({ sessionInfo: { skills: [], tools: [] } });
    fireEvent.click(screen.getByTestId('palette-add-skill'));
    await screen.findByTestId('wf-node-skill');
    const hint = await screen.findByTestId('catalog-empty');
    expect(hint.textContent).toMatch(/no skills/i);
    // Tool node shows its own empty-state message.
    fireEvent.click(screen.getByTestId('palette-add-tool'));
    await screen.findByTestId('wf-node-tool');
    const toolHint = await screen.findByTestId('catalog-empty');
    expect(toolHint.textContent).toMatch(/no tools/i);
  });

  it('falls back to a free-text field when no session is attached', async () => {
    await openBuilder(); // session.info → null
    fireEvent.click(screen.getByTestId('palette-add-skill'));
    await screen.findByTestId('wf-node-skill');
    const field = await screen.findByTestId('field-action');
    expect(field.tagName).toBe('INPUT');
    fireEvent.change(field, { target: { value: 'hand-typed-skill' } });
    expect((field as HTMLInputElement).value).toBe('hand-typed-skill');
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

  it('pointerup on empty canvas opens the insert menu; Escape cancels the pending edge', async () => {
    await twoNodes();
    const canvas = screen.getByTestId('workflow-canvas');
    firePointer(screen.getByTestId('wf-handle-prompt-needs-right'), 'pointerDown', 240, 84, 2);
    firePointer(canvas, 'pointerMove', 700, 500, 2);
    expect(screen.getByTestId('temp-connection')).toBeInTheDocument(); // line is live mid-drag
    firePointer(canvas, 'pointerUp', 700, 500, 2);
    // Released on empty canvas → the insert menu offers to create a node there
    // (the pending line stays as a preview).
    expect(await screen.findByTestId('insert-node-menu')).toBeInTheDocument();
    expect(screen.getByTestId('temp-connection')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('insert-node-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('temp-connection')).not.toBeInTheDocument(); // cleared
    expect(screen.queryByTestId('wf-edge-needs:prompt->prompt_2')).not.toBeInTheDocument();
  });

  it('picking a kind from the insert menu creates the node at the drop point, wired to the edge', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // id "prompt" @ (40,40)
    await screen.findByTestId('wf-node-prompt');
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 500, 300); // empty spot
    const menu = await screen.findByTestId('insert-node-menu');
    fireEvent.click(within(menu).getByTestId('insert-add-skill'));
    // The new node exists, the pending `needs` edge landed on it, menu closed.
    expect(await screen.findByTestId('wf-node-skill')).toBeInTheDocument();
    expect(await screen.findByTestId('wf-edge-needs:prompt->skill')).toBeInTheDocument();
    expect(screen.queryByTestId('insert-node-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('temp-connection')).not.toBeInTheDocument();
  });

  it("inserting from a condition's 'then' handle wires the branch to the new node", async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-condition')); // id "condition" @ (40,40)
    await screen.findByTestId('wf-node-condition');
    dragConnect('wf-handle-condition-then-right', 240, 70, 500, 300);
    const menu = await screen.findByTestId('insert-node-menu');
    fireEvent.click(within(menu).getByTestId('insert-add-prompt'));
    expect(await screen.findByTestId('wf-node-prompt')).toBeInTheDocument();
    expect(await screen.findByTestId('wf-edge-then:condition->prompt')).toBeInTheDocument();
  });

  it('clicking away on the canvas dismisses the insert menu without inserting', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 500, 300);
    await screen.findByTestId('insert-node-menu');
    firePointer(screen.getByTestId('workflow-canvas'), 'pointerDown', 700, 500, 3);
    expect(screen.queryByTestId('insert-node-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('temp-connection')).not.toBeInTheDocument();
    // Only the original node remains.
    expect(screen.queryByTestId('wf-node-prompt_2')).not.toBeInTheDocument();
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

  it('Delete removes the selected node and its edges (same op as the inspector button)', async () => {
    await twoNodes();
    dragConnect('wf-handle-prompt-needs-right', 240, 84, 460, 320); // wire A→B
    await screen.findByTestId('wf-edge-needs:prompt->prompt_2');
    // Select A by pressing down on its card body.
    firePointer(screen.getByTestId('wf-node-prompt'), 'pointerDown', 120, 80);
    firePointer(screen.getByTestId('workflow-canvas'), 'pointerUp', 120, 80);
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(screen.queryByTestId('wf-node-prompt')).not.toBeInTheDocument());
    expect(screen.queryByTestId('wf-edge-needs:prompt->prompt_2')).not.toBeInTheDocument();
    expect(screen.getByTestId('wf-node-prompt_2')).toBeInTheDocument(); // the other node survives
  });

  it('Backspace removes the selected node', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // add-step auto-selects
    await screen.findByTestId('wf-node-prompt');
    fireEvent.keyDown(window, { key: 'Backspace' });
    await waitFor(() => expect(screen.queryByTestId('wf-node-prompt')).not.toBeInTheDocument());
  });

  it('Delete/Backspace does NOT delete while typing in an inspector field', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    // The node auto-selects → the inspector shows; key events from its fields
    // are text editing, not graph commands.
    const action = await screen.findByTestId('field-action');
    fireEvent.keyDown(action, { key: 'Backspace' });
    fireEvent.keyDown(action, { key: 'Delete' });
    expect(screen.getByTestId('wf-node-prompt')).toBeInTheDocument();
  });
});

/**
 * Infinite-canvas pan/zoom. The world is rendered through a single
 * `translate(x, y) scale(zoom)` on the content layer (testid canvas-content);
 * these tests parse that transform to assert the view maths. jsdom's
 * getBoundingClientRect is all-zeros, so client coords == viewport coords and
 * `world = (client − view.pan) / view.zoom` exactly.
 */
describe('WorkflowsPanel — infinite canvas pan/zoom', () => {
  async function openWith(): Promise<void> {
    installApi({ list: [] });
    render(<WorkflowsPanel />);
    fireEvent.click(await screen.findByTestId('new-workflow'));
    await screen.findByTestId('workflow-canvas');
  }

  /** Parse the content layer's `translate(xpx, ypx) scale(z)` transform. */
  function getView(): { x: number; y: number; zoom: number } {
    const t = (screen.getByTestId('canvas-content') as HTMLElement).style.transform;
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)/.exec(t);
    if (!m) throw new Error(`unexpected canvas transform: ${t}`);
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
  }

  it('plain wheel pans BOTH axes (no horizontal-strip scrolling)', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // node @ (40,40)
    await screen.findByTestId('wf-node-prompt');
    const canvas = screen.getByTestId('workflow-canvas');
    fireEvent.wheel(canvas, { deltaX: -120, deltaY: -60 });
    expect(getView()).toEqual({ x: 120, y: 60, zoom: 1 });
    // Panning moves the VIEW, not the world: the node keeps its coordinates.
    const node = screen.getByTestId('wf-node-prompt') as HTMLElement;
    expect(node.style.left).toBe('40px');
    expect(node.style.top).toBe('40px');
    // And it pans back past the origin without any scroll clamp.
    fireEvent.wheel(canvas, { deltaX: 300, deltaY: 200 });
    expect(getView()).toEqual({ x: -180, y: -140, zoom: 1 });
  });

  it('ctrl+wheel zooms anchored at the cursor (the world point under it stays fixed)', async () => {
    await openWith();
    const canvas = screen.getByTestId('workflow-canvas');
    // World point under the cursor before zooming: (100 − 0) / 1 = 100.
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -200, clientX: 100, clientY: 100 });
    const zoomed = getView();
    expect(zoomed.zoom).toBeGreaterThan(1);
    // anchor = world·zoom + pan ⇒ the same world point must sit under (100,100).
    expect((100 - zoomed.x) / zoomed.zoom).toBeCloseTo(100, 6);
    expect((100 - zoomed.y) / zoomed.zoom).toBeCloseTo(100, 6);
    // Zoom again at a DIFFERENT cursor point — that point must now hold still.
    const worldX = (300 - zoomed.x) / zoomed.zoom;
    const worldY = (40 - zoomed.y) / zoomed.zoom;
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -150, clientX: 300, clientY: 40 });
    const again = getView();
    expect(again.zoom).toBeGreaterThan(zoomed.zoom);
    expect((300 - again.x) / again.zoom).toBeCloseTo(worldX, 6);
    expect((40 - again.y) / again.zoom).toBeCloseTo(worldY, 6);
    // Double-click on empty canvas resets to 100%.
    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 50 });
    expect(getView().zoom).toBe(1);
  });

  it('ctrl+wheel zoom is clamped to the 10%–400% range', async () => {
    await openWith();
    const canvas = screen.getByTestId('workflow-canvas');
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100000, clientX: 0, clientY: 0 });
    expect(getView().zoom).toBe(4);
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: 100000, clientX: 0, clientY: 0 });
    expect(getView().zoom).toBe(0.1);
  });

  it('nodes live happily at NEGATIVE coordinates: render, select, and receive connections', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // A @ (40,40)
    await screen.findByTestId('wf-node-prompt');
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // B @ (80,80)
    await screen.findByTestId('wf-node-prompt_2');
    const canvas = screen.getByTestId('workflow-canvas');
    // Drag B deep into negative space (grab its origin so dx=dy=0).
    firePointer(screen.getByTestId('wf-node-prompt_2'), 'pointerDown', 80, 80);
    firePointer(canvas, 'pointerMove', -400, -300);
    firePointer(canvas, 'pointerUp', -400, -300);
    const b = screen.getByTestId('wf-node-prompt_2') as HTMLElement;
    expect(b.style.left).toBe('-400px');
    expect(b.style.top).toBe('-300px');
    // Connector hit-testing works at negative world coords: A.output → B.
    firePointer(screen.getByTestId('wf-handle-prompt-needs-right'), 'pointerDown', 240, 84, 2);
    firePointer(canvas, 'pointerMove', -350, -260, 2);
    firePointer(canvas, 'pointerUp', -350, -260, 2);
    expect(await screen.findByTestId('wf-edge-needs:prompt->prompt_2')).toBeInTheDocument();
    // And the node is still clickable: deselect, then select it again.
    fireEvent.click(canvas);
    expect(screen.queryByTestId('field-action')).not.toBeInTheDocument();
    firePointer(b, 'pointerDown', -380, -280);
    firePointer(canvas, 'pointerUp', -380, -280);
    expect(await screen.findByTestId('field-action')).toBeInTheDocument();
  });

  it('the insert menu opens at the correct WORLD position while panned + zoomed', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt')); // source @ (40,40)
    await screen.findByTestId('wf-node-prompt');
    const canvas = screen.getByTestId('workflow-canvas');
    // Pan to (120, 60), then zoom in once via the button: the button anchors at
    // the viewport centre (0,0 in jsdom) → view = (144, 72) @ 1.2×.
    fireEvent.wheel(canvas, { deltaX: -120, deltaY: -60 });
    fireEvent.click(screen.getByTestId('canvas-zoom-in'));
    expect(getView()).toEqual({ x: 144, y: 72, zoom: 1.2 });
    // Drop a connection on empty canvas at client (444, 312) — world
    // ((444−144)/1.2, (312−72)/1.2) = (250, 200).
    firePointer(screen.getByTestId('wf-handle-prompt-needs-right'), 'pointerDown', 0, 0, 2);
    firePointer(canvas, 'pointerMove', 444, 312, 2);
    firePointer(canvas, 'pointerUp', 444, 312, 2);
    const menu = (await screen.findByTestId('insert-node-menu')) as HTMLElement;
    expect(parseFloat(menu.style.left)).toBeCloseTo(250, 6);
    expect(parseFloat(menu.style.top)).toBeCloseTo(200, 6);
    // Inserting places the node at the drop point (input anchor on the drop):
    // y is offset by half the node height (88/2 = 44).
    fireEvent.click(within(menu).getByTestId('insert-add-skill'));
    const node = (await screen.findByTestId('wf-node-skill')) as HTMLElement;
    expect(parseFloat(node.style.left)).toBeCloseTo(250, 6);
    expect(parseFloat(node.style.top)).toBeCloseTo(156, 6);
    expect(await screen.findByTestId('wf-edge-needs:prompt->skill')).toBeInTheDocument();
  });

  it('drag-to-pan on empty canvas moves the view and keeps a still click deselecting', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    const canvas = screen.getByTestId('workflow-canvas');
    firePointer(canvas, 'pointerDown', 500, 400);
    firePointer(canvas, 'pointerMove', 560, 340); // +60, −60
    firePointer(canvas, 'pointerUp', 560, 340);
    expect(getView()).toEqual({ x: 60, y: -60, zoom: 1 });
    // The selection survives a moved pan (the trailing click is swallowed)…
    fireEvent.click(canvas);
    expect(screen.getByTestId('field-action')).toBeInTheDocument();
    // …but a still click on the background still deselects.
    firePointer(canvas, 'pointerDown', 500, 400);
    firePointer(canvas, 'pointerUp', 500, 400);
    fireEvent.click(canvas);
    expect(screen.queryByTestId('field-action')).not.toBeInTheDocument();
  });

  it('zoom-to-fit recovers a lost view (jsdom zero-size rect → reset path)', async () => {
    await openWith();
    fireEvent.click(screen.getByTestId('palette-add-prompt'));
    await screen.findByTestId('wf-node-prompt');
    // Wander far off, then fit. jsdom's viewport rect is zero-size, which
    // exercises the degenerate-rect fallback: reset to origin @ 100%. (The
    // real bbox-centring math needs a layout engine; asserted by formula in
    // the component.)
    const canvas = screen.getByTestId('workflow-canvas');
    fireEvent.wheel(canvas, { deltaX: -999, deltaY: -999 });
    fireEvent.click(screen.getByTestId('canvas-zoom-fit'));
    expect(getView()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
