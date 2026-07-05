/**
 * session.* handler tests.
 *
 * Two suites live here:
 *
 *  1. General session.* IPC handlers (session.info / setModel / setAutoApprove /
 *     runTurn inline-attachment forwarding) — drivers / setActiveBus /
 *     registerSessionHandlers wiring.
 *
 *  2. The attachment provenance gate. Regression guard for the chat-image /
 *     browser-screenshot drop bug: a pasted, dropped, or browser-captured image
 *     is persisted to a temp file by `session.saveImageAttachment` (it lives
 *     under os.tmpdir(), NOT the workspace cwd, and the native picker never
 *     handed it out). `session.runTurn` then gates every attachment through
 *     `authorizeAttachments`, so unless saveImageAttachment REMEMBERS the temp
 *     path it just wrote, the image is silently dropped and the prompt reaches
 *     the model as text only — exactly the bug the user hit with a browser
 *     screenshot. These tests pin both halves: the saved path survives the gate,
 *     and an un-vouched path outside the cwd does not.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// session.ts pulls in electron (ipcMain registration; dialog / BrowserWindow —
// only pickAttachment uses them) and, via shared.ts, the in-process plugin bag
// (STT + vault). None is exercised here, so stub everything so the tests need no
// GUI / keychain. One combined mock that provides every electron member either
// suite touches.
vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));
// Control the in-process (Codex) transcriber + vault the voice FALLBACK path
// uses. getInProcessPlugins() caches the bag on first access, so the fake bag's
// methods delegate to stable vi.fns each test configures — no cache reset needed.
const { codexTranscribe, vaultGet } = vi.hoisted(() => ({
  codexTranscribe: vi.fn(),
  vaultGet: vi.fn(),
}));
vi.mock('../in-process-plugins', () => ({
  buildInProcessPlugins: () => ({
    vault: { get: vaultGet },
    transcriber: { name: 'openai-codex', transcribe: codexTranscribe },
  }),
}));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName, IpcEvents, SessionInfo } from '@moxxy/desktop-ipc-contract';
import { drivers, publishDriver, setActiveBus, unpublishDriver } from './shared';
import { registerSessionHandlers } from './session';
import type { RunnerPool } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';
import type { SessionDriver } from '../session-driver';
import { desktopEventBus } from '../event-bus';
import { __resetPickedAttachments } from '../attachment-authz';

type Handler = (...args: unknown[]) => Promise<unknown>;

function fakeBus(): { bus: CommandBus; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as unknown as CommandBus;
  return { bus, handlers };
}

function sessionInfo(sessionId: string): SessionInfo {
  return {
    sessionId,
    cwd: '/tmp/moxxy-test',
    activeProvider: 'openai-codex',
    providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5' }] }],
    activeMode: 'default',
    activeModeBadge: null,
    modes: ['default'],
    tools: [],
    skills: [],
    commands: [],
    readyProviders: ['openai-codex'],
    hasTranscriber: false,
    activeTranscriber: null,
    hasSynthesizer: false,
    activeSynthesizer: null,
  };
}

describe('session.info handler', () => {
  it('waits for a cold-started supervisor to expose its remote session', async () => {
    const poolEmitter = new EventEmitter();
    let supervisor: { remote: () => { getInfo: () => SessionInfo } | null } | null = null;
    const pool = Object.assign(poolEmitter, {
      activeWorkspaceId: () => 'fresh-session',
      get: (id: string) => (id === 'fresh-session' ? supervisor : null),
    }) as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    const result = handlers.get('session.info')!({ workspaceId: 'fresh-session' });
    await Promise.resolve();
    supervisor = { remote: () => ({ getInfo: () => sessionInfo('fresh-session') }) };
    poolEmitter.emit('change', 'fresh-session');

    await expect(result).resolves.toMatchObject({
      sessionId: 'fresh-session',
      activeProvider: 'openai-codex',
      activeMode: 'default',
    });
  });
});

describe('session.setModel handler', () => {
  it('broadcasts the shared per-session model choice to every surface', async () => {
    const events: Array<{ channel: keyof IpcEvents; payload: unknown }> = [];
    const off = desktopEventBus.addSink({
      broadcast: (channel, payload) => events.push({ channel, payload }),
    });
    const pool = {
      activeWorkspaceId: () => 'ws-model',
      get: (id: string) => (id === 'ws-model' ? ({ remote: () => null } as RunnerSupervisor) : null),
    } as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    await handlers.get('session.setModel')!({ workspaceId: 'ws-model', model: 'gpt-5.4' });

    expect(events).toContainEqual({
      channel: 'session.model.changed',
      payload: { workspaceId: 'ws-model', model: 'gpt-5.4' },
    });
    off();
  });
});

describe('session.setAutoApprove handler', () => {
  it('updates the driver and broadcasts the shared auto-approve state to every surface', async () => {
    const events: Array<{ channel: keyof IpcEvents; payload: unknown }> = [];
    const off = desktopEventBus.addSink({
      broadcast: (channel, payload) => events.push({ channel, payload }),
    });
    const setAutoApprove = vi.fn();
    drivers.set('ws-auto', { setAutoApprove } as unknown as SessionDriver);
    const pool = {
      activeWorkspaceId: () => 'ws-auto',
      get: () => null,
    } as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    try {
      await handlers.get('session.setAutoApprove')!({
        workspaceId: 'ws-auto',
        enabled: true,
      });

      expect(setAutoApprove).toHaveBeenCalledWith(true);
      expect(events).toContainEqual({
        channel: 'session.autoApprove.changed',
        payload: { workspaceId: 'ws-auto', enabled: true },
      });
    } finally {
      drivers.delete('ws-auto');
      off();
    }
  });
});

describe('session.runTurn handler', () => {
  it('forwards remote inline attachments to the session driver', async () => {
    const inlineAttachments = [
      {
        kind: 'image' as const,
        content: 'AQID',
        mediaType: 'image/png',
        name: 'phone-screen.png',
      },
    ];
    const runTurn = vi.fn().mockResolvedValue({ turnId: 'turn-inline' });
    drivers.set('ws-inline', { runTurn } as unknown as SessionDriver);
    const pool = {
      activeWorkspaceId: () => 'ws-inline',
      get: (id: string) =>
        id === 'ws-inline'
          ? ({
              getCwd: () => '/tmp/moxxy-test',
              remote: () => null,
            } as unknown as RunnerSupervisor)
          : null,
    } as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    try {
      await handlers.get('session.runTurn')!({
        workspaceId: 'ws-inline',
        prompt: 'Przeanalizuj obraz',
        inlineAttachments,
      });

      expect(runTurn).toHaveBeenCalledWith(
        'Przeanalizuj obraz',
        undefined,
        undefined,
        inlineAttachments,
      );
    } finally {
      drivers.delete('ws-inline');
    }
  });
});

describe('session.transcribe / hasTranscriber fallback chain', () => {
  const WS = 'ws-voice';
  const AUDIO = 'AAAA'; // valid 3-byte base64
  const MIME = 'audio/x-moxxy-pcm16-24khz'; // the desktop mic capture tag

  // A pool whose single workspace's supervisor exposes the given fake remote
  // (or null to model "not connected to a runner").
  function makePool(remote: unknown): RunnerPool {
    return {
      activeWorkspaceId: () => WS,
      get: (id: string) =>
        id === WS ? ({ remote: () => remote } as unknown as RunnerSupervisor) : null,
    } as unknown as RunnerPool;
  }

  function register(pool: RunnerPool): Map<string, Handler> {
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);
    return handlers;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes transcribe to the runner active transcriber (offline local STT), not Codex', async () => {
    const runnerTranscribe = vi.fn(async () => ({ text: 'hello from the runner' }));
    const remote = {
      getInfo: () => ({ ...sessionInfo(WS), activeTranscriber: 'stt-local' }),
      transcribers: { tryGetActive: () => ({ name: 'stt-local', transcribe: runnerTranscribe }) },
    };
    const handlers = register(makePool(remote));

    await expect(
      handlers.get('session.transcribe')!({ workspaceId: WS, audioBase64: AUDIO, mimeType: MIME }),
    ).resolves.toBe('hello from the runner');
    expect(runnerTranscribe).toHaveBeenCalledTimes(1);
    // The mic's mimeType flows through to the runner transcriber unchanged.
    expect(runnerTranscribe.mock.calls[0]![1]).toEqual({ mimeType: MIME });
    expect(codexTranscribe).not.toHaveBeenCalled();
  });

  it('falls back to the in-process Codex transcriber when the runner has none active', async () => {
    codexTranscribe.mockResolvedValue({ text: 'from codex' });
    const remote = {
      getInfo: () => sessionInfo(WS), // activeTranscriber: null
      transcribers: { tryGetActive: () => null },
    };
    const handlers = register(makePool(remote));

    await expect(
      handlers.get('session.transcribe')!({ workspaceId: WS, audioBase64: AUDIO, mimeType: MIME }),
    ).resolves.toBe('from codex');
    expect(codexTranscribe).toHaveBeenCalledTimes(1);
    expect(codexTranscribe.mock.calls[0]![1]).toEqual({ mimeType: MIME });
  });

  it('falls back to Codex when not connected to a runner at all', async () => {
    codexTranscribe.mockResolvedValue({ text: 'from codex, no runner' });
    const handlers = register(makePool(null)); // supervisor.remote() → null

    await expect(
      handlers.get('session.transcribe')!({ workspaceId: WS, audioBase64: AUDIO }),
    ).resolves.toBe('from codex, no runner');
    expect(codexTranscribe).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error from a present-but-failing runner transcriber (no silent Codex fallback)', async () => {
    const runnerTranscribe = vi.fn(async () => {
      throw new Error('whisper model missing');
    });
    const remote = {
      getInfo: () => ({ ...sessionInfo(WS), activeTranscriber: 'stt-local' }),
      transcribers: { tryGetActive: () => ({ name: 'stt-local', transcribe: runnerTranscribe }) },
    };
    const handlers = register(makePool(remote));

    await expect(
      handlers.get('session.transcribe')!({ workspaceId: WS, audioBase64: AUDIO }),
    ).rejects.toThrow('whisper model missing');
    // A broken local model must NOT quietly fall through to the cloud path.
    expect(codexTranscribe).not.toHaveBeenCalled();
  });

  it('rejects a malformed base64 payload at the handler boundary', async () => {
    const handlers = register(makePool(null));
    await expect(
      handlers.get('session.transcribe')!({ audioBase64: 'not base64!!!' }),
    ).rejects.toThrow(/base64/);
    expect(codexTranscribe).not.toHaveBeenCalled();
  });

  it('hasTranscriber is true when the runner reports an active transcriber (no vault probe)', async () => {
    const remote = { getInfo: () => ({ ...sessionInfo(WS), activeTranscriber: 'stt-local' }) };
    const handlers = register(makePool(remote));

    await expect(handlers.get('session.hasTranscriber')!()).resolves.toBe(true);
    expect(vaultGet).not.toHaveBeenCalled();
  });

  it('hasTranscriber falls back to the Codex vault probe when the runner has none active', async () => {
    vaultGet.mockResolvedValue('a-refresh-token');
    const remote = { getInfo: () => sessionInfo(WS) }; // activeTranscriber: null
    const handlers = register(makePool(remote));

    await expect(handlers.get('session.hasTranscriber')!()).resolves.toBe(true);
    expect(vaultGet).toHaveBeenCalledWith('oauth/openai-codex/refresh_token');
  });

  it('hasTranscriber is false when neither a runner transcriber nor Codex creds exist', async () => {
    vaultGet.mockResolvedValue(null);
    const remote = { getInfo: () => sessionInfo(WS) };
    const handlers = register(makePool(remote));

    await expect(handlers.get('session.hasTranscriber')!()).resolves.toBe(false);
  });
});

describe('session.* attachment provenance', () => {
  const WS = 'ws1';
  const CWD = path.join(os.tmpdir(), 'session-ipc-cwd');

  // 1x1 transparent PNG — the smallest blob persistImageBlob accepts.
  const PNG_1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  let provenanceHandlers: Map<string, Handler>;
  let driverRunTurn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    __resetPickedAttachments();
    await rm(CWD, { recursive: true, force: true });
    await mkdir(CWD, { recursive: true });
    const { bus, handlers } = fakeBus();
    provenanceHandlers = handlers;
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

  afterEach(async () => {
    unpublishDriver(WS);
    await rm(CWD, { recursive: true, force: true });
  });

  const invoke = (channel: string, args?: unknown): Promise<unknown> =>
    provenanceHandlers.get(channel)!(args);

  /** The attachments `session.runTurn` forwarded to the driver after the gate. */
  const forwardedAttachments = (): ReadonlyArray<unknown> =>
    driverRunTurn.mock.calls[0]![2] as ReadonlyArray<unknown>;

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

  it('previews a remembered image attachment without sending it', async () => {
    const saved = (await invoke('session.saveImageAttachment', {
      dataBase64: PNG_1x1,
      mediaType: 'image/png',
      name: 'browser-capture.png',
    })) as { path: string; name: string };

    try {
      await expect(
        invoke('session.previewAttachment', {
          workspaceId: WS,
          path: saved.path,
          name: saved.name,
        }),
      ).resolves.toEqual({
        kind: 'image',
        name: 'browser-capture.png',
        mediaType: 'image/png',
        base64: PNG_1x1,
        byteLength: Buffer.from(PNG_1x1, 'base64').byteLength,
      });
    } finally {
      await rm(saved.path, { force: true });
    }
  });

  it('returns null when the authorized attachment is not an image', async () => {
    const textPath = path.join(CWD, 'notes.txt');
    await writeFile(textPath, 'hello');

    await expect(
      invoke('session.previewAttachment', {
        workspaceId: WS,
        path: textPath,
        name: 'notes.txt',
      }),
    ).resolves.toBeNull();
  });

  it('returns null for an image path that was not picked and is outside the workspace', async () => {
    const stray = path.join(os.tmpdir(), `session-preview-stray-${process.pid}.png`);
    await writeFile(stray, Buffer.from(PNG_1x1, 'base64'));

    try {
      await expect(
        invoke('session.previewAttachment', {
          workspaceId: WS,
          path: stray,
          name: 'stray.png',
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(stray, { force: true });
    }
  });

  it('returns null when an authorized image exceeds the attachment image limit', async () => {
    const huge = path.join(CWD, 'huge.png');
    await writeFile(huge, Buffer.alloc(8 * 1024 * 1024 + 1));

    await expect(
      invoke('session.previewAttachment', {
        workspaceId: WS,
        path: huge,
        name: 'huge.png',
      }),
    ).resolves.toBeNull();
  });
});
