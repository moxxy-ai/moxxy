/**
 * useWorkflowBuilder hook tests — drive the validate/save IPC through the fake
 * api shim and assert the hook loads a workflow, validates on edit, maps errors
 * onto nodes, and persists only when valid.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useWorkflowBuilder } from './useWorkflowBuilder.js';
import { serialize, emptyState, addStep, updateNode, updateMeta } from '@moxxy/workflows-builder';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

afterEach(() => __setApiOverride(null));

function sampleYaml(): string {
  let s = emptyState('demo');
  s = updateMeta(s, { description: 'demo' });
  s = addStep(s, { kind: 'prompt', id: 'a' });
  s = updateNode(s, 'a', { action: 'do a' });
  return serialize(s).yaml;
}

describe('useWorkflowBuilder', () => {
  it('loads a saved workflow by name via getRun', async () => {
    const yaml = sampleYaml();
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.getRun') return { name: 'demo', scope: 'user', path: '/x.yaml', yaml };
      if (cmd === 'workflows.validateDraft') return { ok: true, errors: [] };
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    await act(async () => {
      await result.current.load('demo');
    });
    expect(result.current.state.nodes.map((n) => n.id)).toEqual(['a']);
    expect(result.current.state.meta.name).toBe('demo');
  });

  it('validates on edit and maps errors onto nodes', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.validateDraft') {
        return { ok: false, errors: ['steps: step "a" needs unknown step "ghost"'] };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    act(() => result.current.dispatch({ type: 'add-step', input: { kind: 'prompt', id: 'a' } }));
    await waitFor(() => expect(result.current.valid).toBe(false));
    expect(result.current.state.errors.a).toBeDefined();
  });

  it('save persists only when validation passes', async () => {
    const saved = { name: 'demo', scope: 'user', path: '/x.yaml' };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.validateDraft') return { ok: true, errors: [] };
      if (cmd === 'workflows.save') return saved;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    act(() => result.current.dispatch({ type: 'add-step', input: { kind: 'prompt', id: 'a' } }));
    let res: unknown;
    await act(async () => {
      res = await result.current.save();
    });
    expect(res).toEqual(saved);
    expect(result.current.state.dirty).toBe(false);
    expect(invoke).toHaveBeenCalledWith('workflows.save', expect.objectContaining({ yaml: expect.any(String) }));
  });

  it('passes the loaded name as previousName on save so a rename cleans up (Finding 7)', async () => {
    const yaml = sampleYaml();
    const saved = { name: 'renamed', scope: 'user', path: '/renamed.yaml' };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.getRun') return { name: 'demo', scope: 'user', path: '/demo.yaml', yaml };
      if (cmd === 'workflows.validateDraft') return { ok: true, errors: [] };
      if (cmd === 'workflows.save') return saved;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    await act(async () => {
      await result.current.load('demo');
    });
    // Rename on the canvas, then save.
    act(() => result.current.dispatch({ type: 'update-meta', patch: { name: 'renamed' } }));
    await act(async () => {
      await result.current.save();
    });
    expect(invoke).toHaveBeenCalledWith(
      'workflows.save',
      expect.objectContaining({ previousName: 'demo' }),
    );
  });

  it('omits previousName for a brand-new (unloaded) workflow', async () => {
    const saved = { name: 'fresh', scope: 'user', path: '/fresh.yaml' };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.validateDraft') return { ok: true, errors: [] };
      if (cmd === 'workflows.save') return saved;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    act(() => result.current.dispatch({ type: 'add-step', input: { kind: 'prompt', id: 'a' } }));
    await act(async () => {
      await result.current.save();
    });
    const call = invoke.mock.calls.find((c) => c[0] === 'workflows.save');
    expect(call?.[1]).not.toHaveProperty('previousName');
  });

  it('a stale getRun (earlier load that resolves last) cannot clobber the newer load', async () => {
    // Two concurrent loads on one mounted instance: load('a') is slow, load('b')
    // is fast. Even though 'a' resolves AFTER 'b', the canvas must end up on 'b'
    // (the last-requested load wins).
    let yamlA = '';
    let yamlB = '';
    {
      let sa = emptyState('a');
      sa = addStep(sa, { kind: 'prompt', id: 'a' });
      sa = updateNode(sa, 'a', { action: 'do a' });
      yamlA = serialize(sa).yaml;
      let sb = emptyState('b');
      sb = addStep(sb, { kind: 'prompt', id: 'b' });
      sb = updateNode(sb, 'b', { action: 'do b' });
      yamlB = serialize(sb).yaml;
    }
    let resolveA!: (v: unknown) => void;
    const aGate = new Promise((res) => {
      resolveA = res;
    });
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      if (cmd === 'workflows.validateDraft') return { ok: true, errors: [] };
      if (cmd === 'workflows.getRun') {
        const name = (args as { name: string }).name;
        if (name === 'a') {
          await aGate; // park load('a') until we release it
          return { name: 'a', scope: 'user', path: '/a.yaml', yaml: yamlA };
        }
        return { name: 'b', scope: 'user', path: '/b.yaml', yaml: yamlB };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    let pendingA!: Promise<void>;
    await act(async () => {
      pendingA = result.current.load('a'); // slow — parked
      await result.current.load('b'); // fast — wins
    });
    expect(result.current.state.meta.name).toBe('b');

    // Now release the stale load('a'); it must NOT overwrite the canvas.
    await act(async () => {
      resolveA(undefined);
      await pendingA;
    });
    expect(result.current.state.meta.name).toBe('b');
    expect(result.current.state.nodes.map((n) => n.id)).toEqual(['b']);
  });

  it('a load resolving after unmount does not throw (no dispatch into a dead reducer)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const yaml = sampleYaml();
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.validateDraft') return { ok: true, errors: [] };
      if (cmd === 'workflows.getRun') {
        await gate;
        return { name: 'demo', scope: 'user', path: '/x.yaml', yaml };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result, unmount } = renderHook(() => useWorkflowBuilder());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.load('demo');
    });
    unmount();
    await act(async () => {
      release();
      await pending; // resolves after unmount — must not throw
    });
  });

  it('save refuses and surfaces an error when invalid', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.validateDraft') return { ok: false, errors: ['name: bad'] };
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWorkflowBuilder());
    act(() => result.current.dispatch({ type: 'add-step', input: { kind: 'prompt', id: 'a' } }));
    let res: unknown = 'unset';
    await act(async () => {
      res = await result.current.save();
    });
    expect(res).toBeNull();
    expect(result.current.error).toMatch(/highlighted errors/);
    expect(invoke).not.toHaveBeenCalledWith('workflows.save', expect.anything());
  });
});
