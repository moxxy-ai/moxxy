/**
 * NodeInspector Args (JSON) regression: the textarea must let the user type
 * through invalid intermediate states (a deleted brace, a half-typed key)
 * without snapping back to the last-valid pretty-print, and commit the parsed
 * object only once the JSON is valid again. Previously the field was fully
 * controlled by JSON.stringify(node.args) and reverted on every keystroke that
 * transiently broke parse, making existing args un-editable.
 *
 * Plus regressions for: the switch "+ Add case" inline field (no window.prompt,
 * which throws in Electron), the args prototype-pollution strip, and the
 * step-id draft (clearable to retype without snapping back).
 */

import { useReducer } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeInspector } from './NodeInspector';
import {
  builderReducer,
  type BuilderAction,
  type BuilderNode,
  type BuilderState,
} from '@moxxy/workflows-builder';

function toolNode(args: Record<string, unknown>): BuilderNode {
  return {
    id: 'n1',
    kind: 'tool',
    action: 'http_get',
    x: 0,
    y: 0,
    needs: [],
    onError: 'fail',
    retries: 0,
    args,
  };
}

function baseState(node: BuilderNode): BuilderState {
  return {
    meta: {
      name: 'wf',
      description: '',
      enabled: true,
      version: 1,
      concurrency: 1,
      inputs: {},
    },
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selected: node.id,
    dirty: false,
    errors: {},
  };
}

/**
 * A minimal host that applies `update-node` { args } patches back onto the node
 * — mirroring the real reducer's feedback loop so we can prove a committed edit
 * doesn't clobber the in-progress draft on re-render.
 */
function Harness({ initial }: { initial: Record<string, unknown> }): JSX.Element {
  const [node, dispatch] = useReducer((cur: BuilderNode, action: BuilderAction): BuilderNode => {
    if (action.type === 'update-node' && action.id === cur.id && 'args' in action.patch) {
      return { ...cur, args: action.patch.args as Record<string, unknown> };
    }
    return cur;
  }, toolNode(initial));
  return <NodeInspector state={baseState(node)} node={node} dispatch={dispatch} />;
}

function argsField(): HTMLTextAreaElement {
  return screen.getByTestId('field-args') as HTMLTextAreaElement;
}

describe('NodeInspector Args (JSON)', () => {
  it('retains keystrokes through an invalid intermediate state and commits valid JSON', () => {
    render(<Harness initial={{ a: 1 }} />);

    const ta = argsField();
    // Transiently invalid: a trailing-comma object.
    fireEvent.change(ta, { target: { value: '{ "a": 1, }' } });
    expect(ta.value).toBe('{ "a": 1, }'); // NOT snapped back to the valid pretty-print
    expect(screen.getByTestId('field-args-invalid')).toBeInTheDocument();

    // Finish into a valid object → commits.
    fireEvent.change(ta, { target: { value: '{ "a": 1, "b": 2 }' } });
    expect(ta.value).toBe('{ "a": 1, "b": 2 }');
    expect(screen.queryByTestId('field-args-invalid')).not.toBeInTheDocument();
  });

  it('seeds the draft from the node args on mount', () => {
    render(<Harness initial={{ x: 'y' }} />);
    expect(argsField().value).toBe(JSON.stringify({ x: 'y' }, null, 2));
  });

  it('strips prototype-pollution keys before committing parsed args', () => {
    const committed: Array<Record<string, unknown>> = [];
    function Spy(): JSX.Element {
      const [node, dispatch] = useReducer((cur: BuilderNode, action: BuilderAction): BuilderNode => {
        if (action.type === 'update-node' && action.id === cur.id && 'args' in action.patch) {
          const args = action.patch.args as Record<string, unknown>;
          committed.push(args);
          return { ...cur, args };
        }
        return cur;
      }, toolNode({}));
      return <NodeInspector state={baseState(node)} node={node} dispatch={dispatch} />;
    }
    render(<Spy />);
    fireEvent.change(argsField(), {
      target: { value: '{ "__proto__": { "polluted": true }, "constructor": { "x": 1 }, "safe": 2 }' },
    });
    const last = committed[committed.length - 1]!;
    expect(Object.keys(last)).toEqual(['safe']);
    // The global Object.prototype is never polluted by the committed value.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // No invalid flag — a clean object was committed.
    expect(screen.queryByTestId('field-args-invalid')).not.toBeInTheDocument();
  });

  it('rejects a non-object JSON value (array/primitive) without committing', () => {
    const dispatch = vi.fn();
    render(<NodeInspector state={baseState(toolNode({}))} node={toolNode({})} dispatch={dispatch} />);
    fireEvent.change(argsField(), { target: { value: '[1, 2, 3]' } });
    expect(screen.getByTestId('field-args-invalid')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function switchNode(): BuilderNode {
  return {
    id: 's1',
    kind: 'switch',
    action: 'route on priority',
    x: 0,
    y: 0,
    needs: [],
    onError: 'fail',
    retries: 0,
    cases: {},
  };
}

/** Host backed by the REAL builderReducer so set-case / rename actually apply. */
function ReducerHarness({ initial }: { initial: BuilderState }): JSX.Element {
  const [state, dispatch] = useReducer(builderReducer, initial);
  const node = state.nodes.find((n) => n.id === state.selected)!;
  return <NodeInspector state={state} node={node} dispatch={dispatch} />;
}

function switchState(): BuilderState {
  const node = switchNode();
  return { ...baseState(node), nodes: [node], selected: node.id };
}

describe('NodeInspector switch "+ Add case"', () => {
  it('adds a case via the inline field (never calls window.prompt, which throws in Electron)', () => {
    // Make prompt throw exactly like Electron's renderer so a regression to the
    // old window.prompt() path would surface as a test failure, not a silent no-op.
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('prompt() is and will not be supported.');
    });
    render(<ReducerHarness initial={switchState()} />);

    fireEvent.change(screen.getByTestId('add-case-input'), { target: { value: 'High Priority!' } });
    fireEvent.click(screen.getByTestId('add-case'));

    // Slugified id surfaces as a case row + its target picker.
    expect(screen.getByTestId('case-high_priority')).toBeInTheDocument();
    // The input cleared for the next entry.
    expect((screen.getByTestId('add-case-input') as HTMLInputElement).value).toBe('');
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('disables Add for an empty/whitespace draft and flags a duplicate case', () => {
    const initial = switchState();
    const seeded = builderReducer(initial, { type: 'set-case', nodeId: 's1', caseId: 'high', targets: [] });
    render(<ReducerHarness initial={seeded} />);

    // Empty → disabled.
    expect((screen.getByTestId('add-case') as HTMLButtonElement).disabled).toBe(true);
    // Duplicate slug → disabled + inline warning, no new row.
    fireEvent.change(screen.getByTestId('add-case-input'), { target: { value: 'HIGH' } });
    expect((screen.getByTestId('add-case') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('add-case-invalid')).toBeInTheDocument();
  });

  it('submits the case on Enter', () => {
    render(<ReducerHarness initial={switchState()} />);
    const input = screen.getByTestId('add-case-input');
    fireEvent.change(input, { target: { value: 'low' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('case-low')).toBeInTheDocument();
  });
});

describe('NodeInspector step-id field', () => {
  it('lets the user clear and retype the id instead of snapping back mid-edit', () => {
    render(<ReducerHarness initial={switchState()} />);
    const id = screen.getByTestId('field-id') as HTMLInputElement;
    // Clear the field → the draft stays empty (no snap-back to "s1") and a hint shows.
    fireEvent.change(id, { target: { value: '' } });
    expect(id.value).toBe('');
    expect(screen.getByTestId('field-id-invalid')).toBeInTheDocument();
    // Type a fresh valid id → it commits (the field shows the new id).
    fireEvent.change(id, { target: { value: 'router' } });
    expect(id.value).toBe('router');
    expect(screen.queryByTestId('field-id-invalid')).not.toBeInTheDocument();
  });
});
