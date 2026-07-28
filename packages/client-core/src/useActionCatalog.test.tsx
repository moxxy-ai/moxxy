import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActionCatalog } from './useActionCatalog.js';
import { __setApiOverride } from './transport.js';

/**
 * The catalog is an ENHANCEMENT: callers use it to enrich what they render and
 * every one of them has a defined fallback for "no catalog". So failing to
 * reach the runner must degrade, never throw, or a component that merely wanted
 * nicer output turns a configured transport into a hard requirement for
 * rendering at all.
 */
describe('useActionCatalog', () => {
  it('stays empty instead of throwing when no transport is configured', () => {
    __setApiOverride(undefined);

    const { result } = renderHook(() => useActionCatalog());

    expect(result.current.loaded).toBe(false);
    expect(result.current.tools).toEqual([]);
  });

  it('stays empty when the runner rejects the request', async () => {
    __setApiOverride({ invoke: async () => Promise.reject(new Error('nope')) } as never);

    const { result } = renderHook(() => useActionCatalog());

    await waitFor(() => expect(result.current.loaded).toBe(false));
    expect(result.current.tools).toEqual([]);
  });

  it('exposes the tools the runner reported, including their declared icons', async () => {
    __setApiOverride({
      invoke: async () => ({
        skills: [],
        tools: [
          { name: 'Read', description: 'read a file', icon: 'file' },
          { name: 'mystery', description: 'undeclared' },
        ],
      }),
    } as never);

    const { result } = renderHook(() => useActionCatalog());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.tools[0]?.icon).toBe('file');
    expect(result.current.tools[1]?.icon).toBeUndefined();
  });
});
