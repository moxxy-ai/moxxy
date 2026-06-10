/**
 * Tolerant protocol negotiation (Part A of the runner-protocol-skew fix).
 *
 * The server accepts any client whose version is >= MIN_COMPATIBLE_PROTOCOL_VERSION
 * (additive skew is non-fatal) and rejects only genuinely-incompatible clients
 * below the floor. A newer client gates version-specific methods on the SERVER's
 * reported version, degrading with an actionable error against an older runner
 * rather than a raw JSON-RPC method-not-found.
 */
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Session,
  autoAllowResolver,
  silentLogger,
} from '@moxxy/core';
import { definePlugin, defineProvider } from '@moxxy/sdk';
import { FakeProvider, textReply } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { startRunnerServer, type RunnerServer } from './server.js';
import { RemoteSession, connectRemoteSession, isProtocolMismatchError } from './remote-session.js';
import { JsonRpcPeer } from './jsonrpc.js';
import type { Transport } from './transport.js';
import {
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  RUNNER_PROTOCOL_VERSION,
  RunnerMethod,
  type AttachResult,
} from './protocol.js';

function buildSession(provider: FakeProvider): Session {
  const session = new Session({
    cwd: process.cwd(),
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'neg-shim',
      providers: [
        defineProvider({
          name: provider.name,
          models: [...provider.models],
          createClient: () => provider,
        }),
      ],
    }),
  );
  session.providers.setActive(provider.name);
  session.pluginHost.registerStatic(defaultModePlugin);
  return session;
}

function tmpSocket(): string {
  return path.join(os.tmpdir(), `moxxy-neg-${Math.random().toString(36).slice(2, 10)}.sock`);
}

const servers: RunnerServer[] = [];

async function serve(): Promise<string> {
  const socketPath = tmpSocket();
  const server = await startRunnerServer(buildSession(new FakeProvider({ script: [textReply('hi')] })), {
    socketPath,
  });
  servers.push(server);
  return socketPath;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** A pair of in-memory transports wired to each other (mirrors jsonrpc.test). */
function makePair(): [Transport, Transport] {
  let aOnFrame: ((f: unknown) => void) | undefined;
  let bOnFrame: ((f: unknown) => void) | undefined;
  let aOnClose: ((e?: Error) => void) | undefined;
  let bOnClose: ((e?: Error) => void) | undefined;
  let closed = false;
  const closeBoth = (): void => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      aOnClose?.();
      bOnClose?.();
    });
  };
  const a: Transport = {
    send: (f) => {
      if (!closed) queueMicrotask(() => bOnFrame?.(f));
    },
    onFrame: (h) => {
      aOnFrame = h;
    },
    onClose: (h) => {
      aOnClose = h;
    },
    close: closeBoth,
  };
  const b: Transport = {
    send: (f) => {
      if (!closed) queueMicrotask(() => aOnFrame?.(f));
    },
    onFrame: (h) => {
      bOnFrame = h;
    },
    onClose: (h) => {
      bOnClose = h;
    },
    close: closeBoth,
  };
  return [a, b];
}

describe('tolerant protocol negotiation — server handshake', () => {
  it('the compatibility floor is at or below the current version', () => {
    // Sanity: a current client must always be accepted by a current server.
    expect(MIN_COMPATIBLE_PROTOCOL_VERSION).toBeLessThanOrEqual(RUNNER_PROTOCOL_VERSION);
    // Every change through v4 has been additive — the floor is still 1.
    expect(MIN_COMPATIBLE_PROTOCOL_VERSION).toBe(1);
  });

  it('accepts a client at the current protocol version', async () => {
    const socketPath = await serve();
    // connectRemoteSession sends RUNNER_PROTOCOL_VERSION; a clean attach proves
    // the current-vs-current path works.
    const remote = await connectRemoteSession({ socketPath, role: 'current' });
    expect(remote.runnerProtocolVersion).toBe(RUNNER_PROTOCOL_VERSION);
    await remote.close();
  });

  it('accepts a client at MIN_COMPATIBLE (additive-skew client on a newer server)', async () => {
    const socketPath = await serve();
    const transport = await import('./unix-socket.js').then((m) =>
      m.connectUnixSocket(socketPath),
    );
    const peer = new JsonRpcPeer(transport);
    // Attach by hand at exactly MIN_COMPATIBLE — an older but still-compatible
    // client. The tolerant server must accept it and report ITS own version.
    const result = await peer.request<AttachResult>(RunnerMethod.Attach, {
      protocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
      role: 'old-but-compatible',
      sinceSeq: 0,
    });
    expect(result.protocolVersion).toBe(RUNNER_PROTOCOL_VERSION);
    expect(result.sessionId).toBeTruthy();
    peer.close();
  });

  it('rejects a client below MIN_COMPATIBLE with a hard mismatch', async () => {
    const socketPath = await serve();
    const transport = await import('./unix-socket.js').then((m) =>
      m.connectUnixSocket(socketPath),
    );
    const peer = new JsonRpcPeer(transport);
    const tooOld = MIN_COMPATIBLE_PROTOCOL_VERSION - 1;
    await expect(
      peer.request(RunnerMethod.Attach, {
        protocolVersion: tooOld,
        role: 'ancient',
        sinceSeq: 0,
      }),
    ).rejects.toThrow(/protocol mismatch/i);
    peer.close();
  });
});

describe('tolerant protocol negotiation — client gating', () => {
  /**
   * A minimal fake server that reports an OLDER protocol version on attach and
   * does NOT implement the v4 builder methods — exactly what a v4 client sees
   * after a desktop JS hot-update outran the v3 CLI it spawns.
   */
  function fakeV3Server(reportedVersion: number): { client: RemoteSession; close: () => void } {
    const [clientT, serverT] = makePair();
    const serverPeer = new JsonRpcPeer(serverT);
    serverPeer.handle(RunnerMethod.Attach, () => ({
      sessionId: 'fake-v3',
      protocolVersion: reportedVersion,
      info: {
        sessionId: 'fake-v3',
        cwd: process.cwd(),
        providers: [],
        tools: [],
        modes: [],
        skills: [],
        commands: [],
        readyProviders: [],
        activeProvider: null,
        activeMode: null,
      },
    }));
    // Deliberately register NO workflow.* handlers — a v3 server lacks them.
    const client = new RemoteSession(clientT);
    return { client, close: () => clientT.close() };
  }

  it('the additive-skew attach SUCCEEDS and records the server version', async () => {
    const { client, close } = fakeV3Server(3);
    await client.attach('desktop', 0);
    expect(client.runnerProtocolVersion).toBe(3);
    close();
  });

  it('gates the v4 builder methods with an actionable error against a v3 server', async () => {
    const { client, close } = fakeV3Server(3);
    await client.attach('desktop', 0);

    await expect(client.workflows.validateDraft('name: x')).rejects.toThrow(
      /not supported by this runner.*update the moxxy CLI/i,
    );
    await expect(client.workflows.save('name: x')).rejects.toThrow(/update the moxxy CLI/i);
    await expect(client.workflows.getRun('x')).rejects.toThrow(/update the moxxy CLI/i);
    close();
  });

  it('allows the v4 builder methods when the server is v4+', async () => {
    let validateCalled = false;
    const [clientT, serverT] = makePair();
    const serverPeer = new JsonRpcPeer(serverT);
    serverPeer.handle(RunnerMethod.Attach, () => ({
      sessionId: 'fake-v4',
      protocolVersion: 4,
      info: {
        sessionId: 'fake-v4',
        cwd: process.cwd(),
        providers: [],
        tools: [],
        modes: [],
        skills: [],
        commands: [],
        readyProviders: [],
        activeProvider: null,
        activeMode: null,
      },
    }));
    serverPeer.handle(RunnerMethod.WorkflowValidateDraft, () => {
      validateCalled = true;
      return { ok: true, errors: [] };
    });
    const client = new RemoteSession(clientT);
    await client.attach('desktop', 0);
    const res = await client.workflows.validateDraft('name: x');
    expect(res.ok).toBe(true);
    expect(validateCalled).toBe(true);
    clientT.close();
  });
});

describe('isProtocolMismatchError', () => {
  it('recognizes the runner mismatch message', () => {
    expect(
      isProtocolMismatchError(new Error('runner protocol mismatch: server v5, client v1')),
    ).toBe(true);
  });
  it('is false for an unrelated error', () => {
    expect(isProtocolMismatchError(new Error('socket closed'))).toBe(false);
  });
});
