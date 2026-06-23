/**
 * cwdForWorkspace routing tests. This is the cwd that scopes both filesystem
 * browsing (workspace.listDir/readFile) AND every git handler (isRepo/status/
 * diff), so a routing bug silently points reads/diffs at the wrong workspace.
 * We also lock the single-derive perf contract: a back-to-back Files-pane
 * render must not derive the desk list multiple times.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// shared.ts (imported transitively by workspace-fs.ts) touches electron;
// importing it must not require the GUI binary.
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { Desk } from '@moxxy/desktop-ipc-contract';
import type { DeskStore } from '../desks';
import { cwdForWorkspace } from './workspace-fs';

function desk(over: Partial<Desk> & Pick<Desk, 'id' | 'cwd'>): Desk {
  return {
    name: over.name ?? over.id,
    color: '#000',
    createdAt: 0,
    sessions: over.sessions ?? [{ id: over.id, name: 'default', createdAt: 0 }],
    activeSessionId: over.activeSessionId ?? over.id,
    ...over,
  };
}

/** A DeskStore stand-in that only implements overview() and counts the calls. */
function fakeStore(activeId: string | null, desks: Desk[]) {
  const loads = { count: 0 };
  const store = {
    overview: async () => {
      loads.count++;
      return { activeId, desks };
    },
  } as unknown as DeskStore;
  return { store, loads };
}

describe('cwdForWorkspace', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'moxxy-workspace-fs-'));
  const cwdA = path.join(root, 'a');
  const cwdB = path.join(root, 'b');
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });

  const a = desk({ id: 'desk-a', cwd: cwdA });
  const b = desk({
    id: 'desk-b',
    cwd: cwdB,
    sessions: [
      { id: 'desk-b', name: 'first', createdAt: 0 },
      { id: 'sess-b2', name: 'second', createdAt: 0 },
    ],
  });

  it('matches a desk by its id', async () => {
    const { store } = fakeStore('desk-a', [a, b]);
    expect(await cwdForWorkspace(store, 'desk-b')).toBe(cwdB);
  });

  it('matches a desk by an owning (non-first) session id', async () => {
    const { store } = fakeStore('desk-a', [a, b]);
    expect(await cwdForWorkspace(store, 'sess-b2')).toBe(cwdB);
  });

  it('falls back to the active desk when the id is unknown', async () => {
    const { store } = fakeStore('desk-b', [a, b]);
    expect(await cwdForWorkspace(store, 'no-such-id')).toBe(cwdB);
  });

  it('falls back to process.cwd() when there is no active desk', async () => {
    const { store } = fakeStore(null, [a, b]);
    expect(await cwdForWorkspace(store, 'no-such-id')).toBe(process.cwd());
  });

  it('falls back to process.cwd() when there are no desks at all', async () => {
    const { store } = fakeStore(null, []);
    expect(await cwdForWorkspace(store, undefined)).toBe(process.cwd());
  });

  it('loads desks.json exactly once regardless of which arm resolves', async () => {
    // id-hit
    const hit = fakeStore('desk-a', [a, b]);
    await cwdForWorkspace(hit.store, 'desk-a');
    expect(hit.loads.count).toBe(1);

    // active-fallback (the arm that used to trigger a SECOND load via getActive())
    const miss = fakeStore('desk-b', [a, b]);
    await cwdForWorkspace(miss.store, 'unknown');
    expect(miss.loads.count).toBe(1);
  });
});
