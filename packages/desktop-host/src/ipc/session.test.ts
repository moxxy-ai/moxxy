/**
 * session.* handler tests — focused on the attachment provenance gate.
 *
 * Regression guard for the chat-image / browser-screenshot drop bug: a pasted,
 * dropped, or browser-captured image is persisted to a temp file by
 * `session.saveImageAttachment` (it lives under os.tmpdir(), NOT the workspace
 * cwd, and the native picker never handed it out). `session.runTurn` then gates
 * every attachment through `authorizeAttachments`, so unless saveImageAttachment
 * REMEMBERS the temp path it just wrote, the image is silently dropped and the
 * prompt reaches the model as text only — exactly the bug the user hit with a
 * browser screenshot. These tests pin both halves: the saved path survives the
 * gate, and an un-vouched path outside the cwd does not.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// session.ts pulls in electron (dialog / BrowserWindow — only pickAttachment
// uses them) and, via shared.ts, the in-process plugin bag (STT + vault).
// Neither is exercised here, so stub both so the test needs no GUI / keychain.
vi.mock('electron', () => ({
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));
vi.mock('../in-process-plugins', () => ({ buildInProcessPlugins: () => ({}) }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { RunnerPool } from '../runner-pool';
import type { SessionDriver } from '../session-driver';
import { __resetPickedAttachments } from '../attachment-authz';
import { publishDriver, setActiveBus, unpublishDriver } from './shared';
import { registerSessionHandlers } from './session';

type Handler = (...args: unknown[]) => Promise<unknown>;

const WS = 'ws1';
const CWD = path.join(os.tmpdir(), 'session-ipc-cwd');

// 1x1 transparent PNG — the smallest blob persistImageBlob accepts.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function fakeBus(): { bus: CommandBus; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, fn: Handler) => handlers.set(channel, fn),
  } as unknown as CommandBus;
  return { bus, handlers };
}

let handlers: Map<string, Handler>;
let driverRunTurn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetPickedAttachments();
  const { bus, handlers: h } = fakeBus();
  handlers = h;
  // A pool whose single workspace reports a cwd (a root for authz to test
  // against) but no live RemoteSession — runTurn dispatches through the driver,
  // so requireSession:false means a null session is fine.
  const pool = {
    activeWorkspaceId: () => WS,
    get: (id: string) => (id === WS ? { getCwd: () => CWD, remote: () => null } : undefined),
  } as unknown as RunnerPool;
  driverRunTurn = vi.fn(async () => ({ turnId: 't1' }));
  publishDriver(WS, { runTurn: driverRunTurn } as unknown as SessionDriver);
  setActiveBus(bus);
  registerSessionHandlers(pool);
});

afterEach(() => {
  unpublishDriver(WS);
});

const invoke = (channel: string, args?: unknown): Promise<unknown> => handlers.get(channel)!(args);

/** The attachments `session.runTurn` forwarded to the driver after the gate. */
const forwardedAttachments = (): ReadonlyArray<unknown> =>
  driverRunTurn.mock.calls[0]![2] as ReadonlyArray<unknown>;

describe('session.* attachment provenance', () => {
  it('saveImageAttachment remembers its temp path so a later runTurn keeps the image', async () => {
    const saved = (await invoke('session.saveImageAttachment', {
      dataBase64: PNG_1x1,
      mediaType: 'image/png',
      name: 'browser-capture.png',
    })) as { path: string; name: string };
    // Sanity: it really did land outside the workspace cwd — the whole reason
    // the provenance gate would otherwise drop it.
    expect(saved.path.startsWith(CWD)).toBe(false);

    try {
      await invoke('session.runTurn', {
        workspaceId: WS,
        prompt: 'what is in this screenshot?',
        attachments: [saved],
      });
      expect(driverRunTurn).toHaveBeenCalledTimes(1);
      expect(forwardedAttachments()).toEqual([saved]); // authorized, NOT dropped
    } finally {
      await rm(saved.path, { force: true });
    }
  });

  it('drops an attachment that was neither picked nor under the workspace cwd', async () => {
    const stray = path.join(os.tmpdir(), `session-ipc-stray-${process.pid}.png`);
    await writeFile(stray, Buffer.from(PNG_1x1, 'base64'));
    try {
      await invoke('session.runTurn', {
        workspaceId: WS,
        prompt: 'read this',
        attachments: [{ path: stray, name: 'stray.png' }],
      });
      expect(driverRunTurn).toHaveBeenCalledTimes(1);
      expect(forwardedAttachments()).toEqual([]); // unauthorized → dropped
    } finally {
      await rm(stray, { force: true });
    }
  });
});
