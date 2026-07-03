/**
 * Unit tests for {@link RemoteSession}'s client-side bookkeeping, driven over an
 * in-memory transport pair (no socket) so a fake server can push raw
 * notifications and answer RPCs by hand.
 *
 * Focus: the bounded `completedTurns` buffer. The runner broadcasts
 * `turn.complete` to EVERY attached client, so an observer that never calls
 * `runTurn` for a turn (the desktop watching a TUI-driven session) must not
 * accumulate one entry per turn forever — yet a genuine fast-turn completion,
 * buffered a tick before its `runTurn` registers, must still finish the stream.
 */
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionInfo, TurnId } from '@moxxy/sdk';
import { JsonRpcPeer } from './jsonrpc.js';
import type { Transport } from './transport.js';
import { RemoteSession, connectWithRetry, isMoxxyCommandLine, spawnText } from './remote-session.js';
import { RunnerMethod, RunnerNotification } from './protocol.js';
import { createUnixSocketServer } from './unix-socket.js';

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

const fakeInfo: SessionInfo = {
  sessionId: 'fake',
  cwd: process.cwd(),
  providers: [],
  tools: [],
  modes: [],
  skills: [],
  commands: [],
  readyProviders: [],
  activeProvider: null,
  activeMode: null,
};

/**
 * A minimal fake server peer over the wire end the client doesn't hold. It
 * answers `attach` and lets the test push raw notifications + answer `runTurn`.
 */
function fakeServer(serverT: Transport): {
  peer: JsonRpcPeer;
  completeTurn: (turnId: string, error?: string) => void;
} {
  const peer = new JsonRpcPeer(serverT);
  peer.handle(RunnerMethod.Attach, () => ({
    sessionId: 'fake',
    protocolVersion: 8,
    info: fakeInfo,
  }));
  return {
    peer,
    completeTurn: (turnId, error) =>
      peer.notify(RunnerNotification.TurnComplete, {
        turnId,
        ...(error ? { error } : {}),
      }),
  };
}

/** Reach into the private bounded buffer for a size assertion. */
function completedTurnsSize(session: RemoteSession): number {
  return (session as unknown as { completedTurns: Map<TurnId, unknown> }).completedTurns.size;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('RemoteSession.completedTurns', () => {
  it('stays bounded under many turn.complete notifications with no matching runTurn', async () => {
    const [clientT, serverT] = makePair();
    const server = fakeServer(serverT);
    const client = new RemoteSession(clientT);
    await client.attach('observer', 0);

    // Simulate an observer client: the runner broadcasts a completion for every
    // turn some OTHER client drove. None of these is ever consumed locally.
    for (let i = 0; i < 1000; i++) {
      server.completeTurn(`turn-${i}`);
    }
    await tick();

    const size = completedTurnsSize(client);
    expect(size).toBeGreaterThan(0);
    // Bounded well below the 1000 broadcasts — the cap holds.
    expect(size).toBeLessThanOrEqual(64);

    clientT.close();
  });

  it('clears the buffer on disconnect (no leak across a dropped link)', async () => {
    const [clientT, serverT] = makePair();
    const server = fakeServer(serverT);
    const client = new RemoteSession(clientT);
    await client.attach('observer', 0);

    for (let i = 0; i < 10; i++) server.completeTurn(`obs-${i}`);
    await tick();
    expect(completedTurnsSize(client)).toBeGreaterThan(0);

    clientT.close();
    await tick();
    expect(completedTurnsSize(client)).toBe(0);
  });

  it('still delivers a buffered completion to a fast turn whose runTurn registers late', async () => {
    const [clientT, serverT] = makePair();
    const server = fakeServer(serverT);
    let runTurnId = '';
    server.peer.handle(RunnerMethod.RunTurn, (raw) => {
      // The turn "completed" on the runner before this reply is processed:
      // push turn.complete now, so it lands before runTurn registers its
      // stream. The client must apply the buffered completion and finish.
      const params = raw as { turnId?: string };
      runTurnId = params.turnId ?? 'srv-minted';
      server.completeTurn(runTurnId);
      return { turnId: runTurnId };
    });

    const client = new RemoteSession(clientT);
    await client.attach('driver', 0);

    // Drive the turn with a client-supplied id so the fast completion matches.
    const types: string[] = [];
    for await (const event of client.runTurn('hi', { turnId: 'fast-1' as TurnId })) {
      types.push(event.type);
    }
    // The stream finished (didn't hang) — the buffered completion was applied.
    expect(runTurnId).toBe('fast-1');
    // And it was consumed out of the buffer, not left to leak.
    expect(completedTurnsSize(client)).toBe(0);

    clientT.close();
  });
});

describe('isMoxxyCommandLine (mismatch-recovery kill gate)', () => {
  it('matches a moxxy daemon by its executable identity', () => {
    expect(isMoxxyCommandLine('moxxy serve')).toBe(true);
    expect(isMoxxyCommandLine('/usr/local/bin/moxxy serve --workspace /x')).toBe(true);
    expect(isMoxxyCommandLine('moxxy-serve --port 4040')).toBe(true);
    expect(isMoxxyCommandLine('/opt/moxxy.js')).toBe(true);
    // Leading whitespace from `ps` is tolerated.
    expect(isMoxxyCommandLine('   moxxy serve')).toBe(true);
  });

  it('does NOT kill an unrelated process that merely references "moxxy" somewhere', () => {
    // The old loose /moxxy/i over the whole line killed all of these.
    expect(isMoxxyCommandLine('vim /Users/me/moxxy/server.ts')).toBe(false);
    expect(isMoxxyCommandLine('grep -r moxxy .')).toBe(false);
    expect(isMoxxyCommandLine('/bin/zsh -c cd ~/moxxy && ls')).toBe(false);
    expect(isMoxxyCommandLine('node /home/me/projects/moxxy/dist/other.js')).toBe(false);
    // Substring-but-not-the-binary names must not match either.
    expect(isMoxxyCommandLine('bigmoxxy --x')).toBe(false);
    expect(isMoxxyCommandLine('moxxyish-tool run')).toBe(false);
    expect(isMoxxyCommandLine('')).toBe(false);
    expect(isMoxxyCommandLine('   ')).toBe(false);
  });
});

describe('spawnText (bounded recovery sub-command)', () => {
  // The recovery sequence (killAndUnlinkRunner) awaits ps/lsof one after the
  // other. If a sub-command hangs (lsof on a stale mount is the classic case)
  // the Promise must still SETTLE — otherwise the whole reconnect path wedges
  // forever. These assert the worst cases the audit's kill gate didn't cover.
  const isWin = process.platform === 'win32';

  it.skipIf(isWin)(
    'kills and gives up on a hung sub-command within the timeout (no infinite hang)',
    async () => {
      // `sleep 60` never exits on its own; a 100ms bound must reclaim it.
      const started = Date.now();
      const out = await spawnText('sleep', ['60'], 100);
      const elapsed = Date.now() - started;
      expect(out).toBe('');
      // Resolved by the timeout, nowhere near the 60s sleep.
      expect(elapsed).toBeLessThan(2_000);
    },
  );

  it('resolves empty (never rejects) when the binary does not exist', async () => {
    const out = await spawnText('definitely-not-a-real-binary-xyzzy', ['--nope'], 1_000);
    expect(out).toBe('');
  });

  it.skipIf(isWin)('returns the trimmed stdout of a fast command', async () => {
    const out = await spawnText('printf', ['hello'], 2_000);
    expect(out).toBe('hello');
  });
});

describe('connectWithRetry (initial-connect linear backoff)', () => {
  function tmpSocket(): string {
    return path.join(os.tmpdir(), `moxxy-retry-${Math.random().toString(36).slice(2, 10)}.sock`);
  }

  it('retries until the socket starts accepting (rides over a late-binding runner)', async () => {
    const socketPath = tmpSocket();
    // Nothing listens yet — the first attempt(s) fail. Bring the server up
    // shortly after, well inside the retry budget (100+200+…+500ms ≈ 1.5s).
    const serverUp = (async () => {
      await new Promise((r) => setTimeout(r, 150));
      return createUnixSocketServer(socketPath);
    })();
    try {
      const transport = await connectWithRetry(socketPath, 5);
      transport.close();
    } finally {
      await (await serverUp).close();
    }
  });

  it('rejects with the last connect error once retries are exhausted', async () => {
    // No server ever appears; 1 retry keeps the test fast (~100ms backoff).
    await expect(connectWithRetry(tmpSocket(), 1)).rejects.toThrow();
  });
});
