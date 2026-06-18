/**
 * WorkspaceFiles reload regression: bumping reloadSignal must re-read the root
 * and each expanded folder exactly once. The reload effect previously iterated
 * the expanded set inside a `setExpanded` updater — React double-invokes
 * updaters in StrictMode, which doubled the workspace.listDir IPC calls. The
 * fix reads the set from a ref in the effect body (updaters stay pure).
 */

import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { WorkspaceFiles } from './WorkspaceFiles';

afterEach(() => {
  __setApiOverride(null);
});

interface DirResult {
  cwd: string;
  entries: ReadonlyArray<{ name: string; kind: 'file' | 'dir' }>;
}

function dirResult(path: string | undefined): DirResult {
  if (path === undefined) {
    // root
    return { cwd: '/repo', entries: [{ name: 'src', kind: 'dir' }] };
  }
  return { cwd: '/repo', entries: [{ name: 'index.ts', kind: 'file' }] };
}

describe('WorkspaceFiles', () => {
  it('reloads each expanded folder exactly once under StrictMode', async () => {
    const calls: Array<string | undefined> = [];
    const invoke = vi.fn(async (cmd: string, args?: { path?: string }) => {
      if (cmd === 'workspace.listDir') {
        calls.push(args?.path);
        return dirResult(args?.path);
      }
      return undefined;
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const { rerender } = render(
      <StrictMode>
        <WorkspaceFiles workspaceId="ws1" reloadSignal={0} />
      </StrictMode>,
    );

    // Root loads, then expand 'src'.
    await waitFor(() => expect(calls.filter((p) => p === undefined).length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByText('src'));
    await waitFor(() => expect(calls).toContain('src'));

    // Bump the reload signal: exactly one root reload + one 'src' reload.
    const before = { root: calls.filter((p) => p === undefined).length, src: calls.filter((p) => p === 'src').length };
    rerender(
      <StrictMode>
        <WorkspaceFiles workspaceId="ws1" reloadSignal={1} />
      </StrictMode>,
    );

    await waitFor(() => expect(calls.filter((p) => p === 'src').length).toBe(before.src + 1));
    // Give StrictMode's double-invoke a chance to (wrongly) fire a second time.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((p) => p === undefined).length).toBe(before.root + 1);
    expect(calls.filter((p) => p === 'src').length).toBe(before.src + 1);
  });
});
