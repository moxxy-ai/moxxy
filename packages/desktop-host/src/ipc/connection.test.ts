/**
 * connection.* handler tests over a REAL DeskStore (temp `MOXXY_HOME`) and a
 * RunnerPool stand-in whose runner may still be starting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { assertDefined } from '@moxxy/sdk';
import { DeskStore } from '../desks';
import type { RunnerPool } from '../runner-pool';
import { registerConnectionHandlers } from './connection';
import { setActiveBus } from './shared';

type Handler = (...args: unknown[]) => Promise<unknown>;

let home: string;
let originalHome: string | undefined;
let desks: DeskStore;
let poolActive: string | null;
const handlers = new Map<string, Handler>();

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'connection-ipc-'));
  originalHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  mkdirSync(path.join(home, 'sessions'), { recursive: true });
  desks = new DeskStore();
  poolActive = null;
  const pool = { activeWorkspaceId: () => poolActive, list: () => [] } as unknown as RunnerPool;
  setActiveBus({ handle: (channel: string, fn: Handler) => handlers.set(channel, fn) } as unknown as CommandBus);
  registerConnectionHandlers(pool, desks);
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

const invoke = (channel: string): Promise<unknown> => {
  const handler = handlers.get(channel);
  assertDefined(handler, `handler for ${channel}`);
  return handler(undefined);
};

describe('connection.activeWorkspace', () => {
  it('names the saved active session while its runner is still starting', async () => {
    const cwd = path.join(home, 'project');
    mkdirSync(cwd);
    const desk = await desks.create({ name: 'Project', cwd });

    await expect(invoke('connection.activeWorkspace')).resolves.toBe(desk.activeSessionId);
  });

  it('follows the runner pool once a runner is in the foreground', async () => {
    const cwd = path.join(home, 'project');
    mkdirSync(cwd);
    await desks.create({ name: 'Project', cwd });
    poolActive = 'running-session';

    await expect(invoke('connection.activeWorkspace')).resolves.toBe('running-session');
  });
});
