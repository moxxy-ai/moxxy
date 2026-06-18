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
import { describe, expect, it } from 'vitest';
import type { SessionInfo, TurnId } from '@moxxy/sdk';
import { JsonRpcPeer } from './jsonrpc.js';
import type { Transport } from './transport.js';
import { RemoteSession } from './remote-session.js';
import { RunnerMethod, RunnerNotification } from './protocol.js';

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
