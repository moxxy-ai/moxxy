/**
 * Structural test for the runner's server-side dispatch table.
 *
 * The ~40 RPC methods were split out of the RunnerServer god-class into
 * per-domain handler modules; the server wires each `RunnerMethod` to a handler
 * in `onConnection`. This test pins that wiring: every CLIENT->SERVER method
 * declared in the protocol MUST have a registered handler (no method falls
 * through to JsonRpcPeer's "unknown method" reply). The two SERVER->CLIENT
 * methods (`permission.check`, `approval.confirm`) are answered on the client
 * side, so they're excluded.
 *
 * It drives a fake transport directly so it needs no live Session/loop: we send
 * a raw request frame for each method and assert the reply is NOT an
 * "unknown method" error (a missing handler).
 */
import { describe, expect, it } from 'vitest';
import type { Session } from '@moxxy/core';
import { RunnerServer } from '../server.js';
import { RunnerMethod } from '../protocol.js';
import type { Transport, TransportServer } from '../transport.js';

/** A no-op session stub: just enough surface for the RunnerServer ctor's
 *  subscriptions + resolver-routing install. No turn ever runs in this test. */
function stubSession(): Session {
  const noopUnsub = () => undefined;
  return {
    resolver: { name: 'stub', check: () => ({ mode: 'allow' as const }) },
    approvalResolver: null,
    setPermissionResolver: () => undefined,
    setApprovalResolver: () => undefined,
    log: { subscribe: () => noopUnsub, onClear: () => noopUnsub },
    modes: { onActiveChange: () => noopUnsub },
    surfaces: { onData: () => noopUnsub, closeAll: () => undefined },
  } as unknown as Session;
}

/** A TransportServer that hands back one in-memory client transport on demand. */
function fakeServerTransport(): {
  server: TransportServer;
  connect: () => {
    send: (frame: unknown) => void;
    received: unknown[];
  };
} {
  let onConnection: ((t: Transport) => void) | undefined;
  const server: TransportServer = {
    address: 'fake',
    onConnection: (h) => {
      onConnection = h;
    },
    close: async () => undefined,
  };
  return {
    server,
    connect: () => {
      // The server side of the link: frames the server SENDS arrive in `received`,
      // frames the test sends are pushed into the server's `onFrame` handler.
      let serverOnFrame: ((f: unknown) => void) | undefined;
      const received: unknown[] = [];
      const serverSide: Transport = {
        send: (f) => received.push(f),
        onFrame: (h) => {
          serverOnFrame = h;
        },
        onClose: () => undefined,
        close: () => undefined,
      };
      onConnection?.(serverSide);
      return {
        send: (frame) => serverOnFrame?.(frame),
        received,
      };
    },
  };
}

/** Methods the SERVER answers (client->server). The two server->client requests
 *  are answered on the client side, so exclude them. */
const SERVER_HANDLED: ReadonlyArray<string> = Object.values(RunnerMethod).filter(
  (m) => m !== RunnerMethod.PermissionCheck && m !== RunnerMethod.ApprovalConfirm,
);

describe('runner dispatch table', () => {
  it('registers a handler for every client->server RunnerMethod', async () => {
    const { server, connect } = fakeServerTransport();
    new RunnerServer(stubSession(), server);
    const client = connect();

    const missing: string[] = [];
    let id = 1;
    for (const method of SERVER_HANDLED) {
      const reqId = id++;
      client.send({ id: reqId, method, params: {} });
      // Let the peer dispatch (handlers may be async; the unknown-method reply is
      // synchronous, but a real handler's parse error is also fine — we only care
      // that SOMETHING handled it rather than the fall-through).
      await new Promise((r) => setTimeout(r, 0));
      const reply = client.received.find(
        (f) => (f as { id?: number }).id === reqId,
      ) as { error?: { message?: string } } | undefined;
      if (reply?.error?.message?.startsWith('unknown method:')) missing.push(method);
    }

    expect(missing).toEqual([]);
  });

  it('excludes exactly the two server->client request methods', () => {
    // Guards against silently dropping a client->server method from the check.
    expect(SERVER_HANDLED).not.toContain(RunnerMethod.PermissionCheck);
    expect(SERVER_HANDLED).not.toContain(RunnerMethod.ApprovalConfirm);
    expect(SERVER_HANDLED).toContain(RunnerMethod.Attach);
    expect(SERVER_HANDLED.length).toBe(Object.values(RunnerMethod).length - 2);
  });
});
