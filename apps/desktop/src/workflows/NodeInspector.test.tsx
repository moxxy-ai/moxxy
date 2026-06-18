/**
 * NodeInspector Args (JSON) regression: the textarea must let the user type
 * through invalid intermediate states (a deleted brace, a half-typed key)
 * without snapping back to the last-valid pretty-print, and commit the parsed
 * object only once the JSON is valid again. Previously the field was fully
 * controlled by JSON.stringify(node.args) and reverted on every keystroke that
 * transiently broke parse, making existing args un-editable.
 */

import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeInspector } from './NodeInspector';
import type {
  BuilderAction,
  BuilderNode,
  BuilderState,
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
});
