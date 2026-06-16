import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitConnectUrl } from '@moxxy/client-transport-ws';
import { encodeWsBearerProtocol, MOXXY_WS_SUBPROTOCOL } from '@moxxy/sdk';
import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';
import {
  WebSocketCommandBus,
  type WebSocketBridgeOptions,
  type WebSocketBridgeServer,
} from '@moxxy/ipc-server-ws';
import {
  MobileGatewayManager,
  resolveWsBridgeConfig,
  rotateWsBridgeToken,
  wsBridgeTokenFile,
  type BridgeRuntime,
} from './ws-bridge.js';

const ENV_KEYS = [
  'MOXXY_WS_BRIDGE',
  'MOXXY_WS_TOKEN',
  'MOXXY_WS_PORT',
  'MOXXY_WS_HOST',
  'MOXXY_WS_ALLOW_QUERY_TOKEN',
] as const;

let saved: Record<string, string | undefined>;
let userData: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MOXXY_WS_BRIDGE = '1';
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'moxxy-ws-bridge-'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('resolveWsBridgeConfig', () => {
  it('returns null when the bridge flag is off', () => {
    delete process.env.MOXXY_WS_BRIDGE;
    expect(resolveWsBridgeConfig(userData)).toBeNull();
  });

  it('treats an EMPTY MOXXY_WS_PORT as unset (Number("") is 0 — an ephemeral bind)', () => {
    process.env.MOXXY_WS_PORT = '';
    expect(resolveWsBridgeConfig(userData)?.port).toBe(8765);
    process.env.MOXXY_WS_PORT = '   ';
    expect(resolveWsBridgeConfig(userData)?.port).toBe(8765);
  });

  it('uses an explicit numeric port and falls back on garbage', () => {
    process.env.MOXXY_WS_PORT = '9001';
    expect(resolveWsBridgeConfig(userData)?.port).toBe(9001);
    process.env.MOXXY_WS_PORT = 'not-a-port';
    expect(resolveWsBridgeConfig(userData)?.port).toBe(8765);
  });

  it('leaves the legacy ?t= query credential OFF unless explicitly enabled', () => {
    expect(resolveWsBridgeConfig(userData)?.allowQueryToken).toBeUndefined();
    process.env.MOXXY_WS_ALLOW_QUERY_TOKEN = '1';
    expect(resolveWsBridgeConfig(userData)?.allowQueryToken).toBe(true);
  });

  it('prefers MOXXY_WS_TOKEN, otherwise persists a generated token under userData', () => {
    process.env.MOXXY_WS_TOKEN = 'env-token';
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe('env-token');

    delete process.env.MOXXY_WS_TOKEN;
    const generated = resolveWsBridgeConfig(userData)?.authToken;
    expect(generated).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(wsBridgeTokenFile(userData))).toBe(true);
    // Stable across restarts (same persisted pairing secret).
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe(generated);
  });

  it('keeps reading a legacy plain-text ws-token file (pre-shared-helper format)', () => {
    fs.writeFileSync(wsBridgeTokenFile(userData), 'legacy-pairing-secret\n');
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe('legacy-pairing-secret');
  });
});

describe('rotateWsBridgeToken', () => {
  it('rewrites the persisted token and re-keys + drops clients on a live server', () => {
    const original = resolveWsBridgeConfig(userData)?.authToken;
    const calls: string[] = [];
    const fakeServer = {
      address: 'ws://127.0.0.1:1',
      onConnection: () => undefined,
      close: () => Promise.resolve(),
      rotateAuthToken: (next: string) => calls.push(next),
      setAllowedOrigins: () => undefined,
      clientCount: () => 0,
    };
    const result = rotateWsBridgeToken(userData, fakeServer);
    expect(result.rotated).toBe(true);
    expect(result.pinned).toBe(false);
    expect(result.token).not.toBe(original);
    expect(calls).toEqual([result.token]);
    // The next resolve picks up the rotated secret.
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe(result.token);
  });

  it('works without a live server (persists only)', () => {
    const result = rotateWsBridgeToken(userData, null);
    expect(result.rotated).toBe(true);
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe(result.token);
  });

  it('is a coherent no-op when MOXXY_WS_TOKEN pins the token', () => {
    // An env-pinned token wins at every resolve, so rotating the FILE token
    // would diverge the live server from the advertised connectUrl. Refuse it.
    process.env.MOXXY_WS_TOKEN = 'pinned-env-token';
    const calls: string[] = [];
    const fakeServer = {
      address: 'ws://127.0.0.1:1',
      onConnection: () => undefined,
      close: () => Promise.resolve(),
      rotateAuthToken: (next: string) => calls.push(next),
      setAllowedOrigins: () => undefined,
      clientCount: () => 0,
    };
    const result = rotateWsBridgeToken(userData, fakeServer);
    expect(result.rotated).toBe(false);
    expect(result.pinned).toBe(true);
    // The reported token is the live (env) one, and the server was NOT re-keyed.
    expect(result.token).toBe('pinned-env-token');
    expect(calls).toEqual([]);
    // The advertised token still matches what the server accepts.
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe('pinned-env-token');
  });
});

// ---- MobileGatewayManager (runtime start/stop/status/rotate) ---------------

/** A fake bridge server that records lifecycle calls without binding a port. */
function makeFakeServer(): {
  server: WebSocketBridgeServer;
  closed: () => boolean;
  rotations: string[];
  originSets: string[][];
  setClients: (n: number) => void;
} {
  let isClosed = false;
  let clients = 0;
  const rotations: string[] = [];
  const originSets: string[][] = [];
  const server: WebSocketBridgeServer = {
    address: 'ws://0.0.0.0:8765',
    onConnection: () => undefined,
    close: () => {
      isClosed = true;
      return Promise.resolve();
    },
    rotateAuthToken: (next: string) => {
      rotations.push(next);
    },
    setAllowedOrigins: (origins: readonly string[]) => {
      originSets.push([...origins]);
    },
    clientCount: () => clients,
  };
  return {
    server,
    closed: () => isClosed,
    rotations,
    originSets,
    setClients: (n: number) => {
      clients = n;
    },
  };
}

function makeRuntime(opts: {
  userData: string;
  startSpy?: (o: unknown) => WebSocketBridgeServer;
  enabledRef?: { value: boolean };
}): {
  rt: BridgeRuntime;
  changes: MobileGatewayStatus[];
  startCalls: unknown[];
  enabledRef: { value: boolean };
} {
  const enabledRef = opts.enabledRef ?? { value: false };
  const changes: MobileGatewayStatus[] = [];
  const startCalls: unknown[] = [];
  const fake = makeFakeServer();
  const rt: BridgeRuntime = {
    wsBridge: {
      startWsBridge: ((_bus: unknown, o: unknown) => {
        startCalls.push(o);
        return Promise.resolve(opts.startSpy ? opts.startSpy(o) : fake.server);
      }) as unknown as typeof import('@moxxy/ipc-server-ws').startWsBridge,
    } as unknown as typeof import('@moxxy/ipc-server-ws'),
    wsBus: {} as WebSocketCommandBus,
    userDataDir: opts.userData,
    readEnabledPref: () => enabledRef.value,
    writeEnabledPref: (enabled: boolean) => {
      enabledRef.value = enabled;
      return Promise.resolve();
    },
    onChange: (s) => changes.push(s),
  };
  return { rt, changes, startCalls, enabledRef };
}

describe('MobileGatewayManager', () => {
  it('reports disabled status before start', () => {
    const { rt } = makeRuntime({ userData });
    const mgr = new MobileGatewayManager(rt);
    expect(mgr.status()).toEqual({
      enabled: false,
      host: null,
      port: null,
      connectUrl: null,
      token: null,
    });
  });

  it('start binds the LAN-advertised interface (0.0.0.0) and produces a connectUrl', async () => {
    const fake = makeFakeServer();
    const { rt, startCalls } = makeRuntime({ userData, startSpy: () => fake.server });
    const mgr = new MobileGatewayManager(rt);
    const status = await mgr.start();
    expect(status.enabled).toBe(true);
    // Default bind is the wildcard interface (LAN exposure).
    expect((startCalls[0] as { host?: string }).host).toBe('0.0.0.0');
    expect(status.port).toBe(8765);
    expect(status.token).toMatch(/^[0-9a-f]{64}$/);
    // The connectUrl carries the token as ?t= and never advertises 0.0.0.0.
    expect(status.connectUrl).toMatch(/^ws:\/\/[^/]+:8765\/\?t=[0-9a-f]{64}$/);
    expect(status.connectUrl).not.toContain('0.0.0.0');
    // The advertised URL's origin is allow-listed post-bind — iOS RN presents
    // it at the upgrade (Origin default-deny would reject iPhones otherwise).
    expect(fake.originSets).toHaveLength(1);
    const origins = fake.originSets[0] ?? [];
    expect(origins).toContain('http://127.0.0.1:8765');
    expect(origins.every((o) => !o.includes('0.0.0.0'))).toBe(true);
  });

  it('setEnabled(true/false) starts, persists, stops, and notifies', async () => {
    const fake = makeFakeServer();
    const { rt, changes, enabledRef } = makeRuntime({
      userData,
      startSpy: () => fake.server,
    });
    const mgr = new MobileGatewayManager(rt);

    const on = await mgr.setEnabled(true);
    expect(on.enabled).toBe(true);
    expect(enabledRef.value).toBe(true); // persisted
    expect(changes.at(-1)?.enabled).toBe(true); // notified

    const off = await mgr.setEnabled(false);
    expect(off.enabled).toBe(false);
    expect(enabledRef.value).toBe(false);
    expect(fake.closed()).toBe(true); // server closed on stop
    expect(changes.at(-1)?.enabled).toBe(false);
  });

  it('resume() re-starts only when the persisted preference is on', async () => {
    const offRuntime = makeRuntime({ userData, enabledRef: { value: false } });
    const offMgr = new MobileGatewayManager(offRuntime.rt);
    await offMgr.resume();
    expect(offMgr.status().enabled).toBe(false);
    expect(offRuntime.startCalls).toHaveLength(0);

    const onRuntime = makeRuntime({ userData, enabledRef: { value: true } });
    const onMgr = new MobileGatewayManager(onRuntime.rt);
    await onMgr.resume();
    expect(onMgr.status().enabled).toBe(true);
    expect(onRuntime.startCalls).toHaveLength(1);
  });

  it('rotateToken re-keys the live server and yields a fresh token + connectUrl', async () => {
    const fake = makeFakeServer();
    const { rt } = makeRuntime({ userData, startSpy: () => fake.server });
    const mgr = new MobileGatewayManager(rt);

    const before = await mgr.start();
    const rotated = await mgr.rotateToken();
    expect(rotated.token).not.toBe(before.token);
    expect(rotated.connectUrl).not.toBe(before.connectUrl);
    // The live server was re-keyed with the new token (drops existing clients).
    expect(fake.rotations).toEqual([rotated.token]);
  });

  it('rotateToken is a no-op when the gateway is off', async () => {
    const { rt } = makeRuntime({ userData });
    const mgr = new MobileGatewayManager(rt);
    const status = await mgr.rotateToken();
    expect(status.enabled).toBe(false);
    expect(status.token).toBeNull();
  });

  it('surfaces the connected-client count in status', async () => {
    const fake = makeFakeServer();
    const { rt } = makeRuntime({ userData, startSpy: () => fake.server });
    const mgr = new MobileGatewayManager(rt);
    await mgr.start();
    fake.setClients(2);
    expect(mgr.status().clientCount).toBe(2);
  });

  it('notifies the renderer when a mobile client connects or disconnects', async () => {
    process.env.MOXXY_WS_HOST = '127.0.0.1';
    process.env.MOXXY_WS_PORT = '0';
    process.env.MOXXY_WS_TOKEN = 'manager-client-count-token';
    const wsBridge = await import('@moxxy/ipc-server-ws');
    const changes: MobileGatewayStatus[] = [];
    const mgr = new MobileGatewayManager({
      wsBridge,
      wsBus: new WebSocketCommandBus(),
      userDataDir: userData,
      readEnabledPref: () => false,
      writeEnabledPref: () => Promise.resolve(),
      onChange: (status) => changes.push(status),
    });

    try {
      const status = await mgr.setEnabled(true);
      const token = status.token ?? '';
      const ws = new WebSocket(`ws://127.0.0.1:${status.port}`, [
        MOXXY_WS_SUBPROTOCOL,
        encodeWsBearerProtocol(token),
      ]);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('websocket failed to open')), {
          once: true,
        });
      });
      await waitFor(() => changes.some((s) => s.clientCount === 1));

      ws.close();
      await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
      await waitFor(() => changes.some((s) => s.clientCount === 0));
    } finally {
      await mgr.setEnabled(false);
    }
  });

  it('does not overwrite a connect event with the stale toggle status', async () => {
    const fake = makeFakeServer();
    let releaseWrite!: () => void;
    const { rt, changes, startCalls } = makeRuntime({
      userData,
      startSpy: () => fake.server,
    });
    (rt as { writeEnabledPref: BridgeRuntime['writeEnabledPref'] }).writeEnabledPref = () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    const mgr = new MobileGatewayManager(rt);

    const enabling = mgr.setEnabled(true);
    await waitFor(() => startCalls.length === 1);
    const opts = startCalls[0] as WebSocketBridgeOptions;
    fake.setClients(1);
    opts.onClientCountChange?.(1);
    releaseWrite();

    const status = await enabling;
    expect(status.clientCount).toBe(1);
    expect(changes.at(-1)?.clientCount).toBe(1);
  });

  it('serializes concurrent start calls so the port binds exactly once', async () => {
    // A slow start: the second concurrent call must wait for the first to settle
    // rather than racing past the `if (this.server)` guard and binding twice.
    let starts = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const fake = makeFakeServer();
    const { rt, startCalls } = makeRuntime({
      userData,
      startSpy: () => fake.server,
    });
    // Wrap startWsBridge to delay the first resolve until we release the gate.
    const original = rt.wsBridge!.startWsBridge as (b: unknown, o: unknown) => Promise<unknown>;
    (rt.wsBridge as { startWsBridge: unknown }).startWsBridge = async (
      bus: unknown,
      o: unknown,
    ) => {
      starts += 1;
      if (starts === 1) await gate;
      return original(bus, o);
    };
    const mgr = new MobileGatewayManager(rt);

    const first = mgr.start();
    const second = mgr.start(); // queued behind the first
    // Let the first proceed; the second resolves off the now-running server.
    releaseFirst();
    await Promise.all([first, second]);

    // Exactly one bind happened despite two concurrent starts.
    expect(startCalls).toHaveLength(1);
  });

  it('serializes a rapid off→on toggle so it cannot leak a server', async () => {
    const fake = makeFakeServer();
    const { rt, startCalls, enabledRef } = makeRuntime({
      userData,
      startSpy: () => fake.server,
      enabledRef: { value: true },
    });
    const mgr = new MobileGatewayManager(rt);
    await mgr.setEnabled(true);

    // Fire off→on back-to-back without awaiting between them.
    const off = mgr.setEnabled(false);
    const on = mgr.setEnabled(true);
    await Promise.all([off, on]);

    // The final state is ON, with one server tracked (no orphan), and the toggle
    // ran to completion in order (start, stop, start).
    expect(mgr.status().enabled).toBe(true);
    expect(enabledRef.value).toBe(true);
    expect(startCalls.length).toBe(2); // initial on + the re-on (off closes, no bind)
  });

  it('rotateToken is a coherent no-op when MOXXY_WS_TOKEN pins the token', async () => {
    process.env.MOXXY_WS_TOKEN = 'pinned-token';
    const fake = makeFakeServer();
    const { rt } = makeRuntime({ userData, startSpy: () => fake.server });
    const mgr = new MobileGatewayManager(rt);
    const before = await mgr.start();
    expect(before.token).toBe('pinned-token');

    const after = await mgr.rotateToken();
    // The live server is NOT re-keyed, and status keeps advertising the env token
    // (so the connectUrl and the accepted token stay in lockstep).
    expect(fake.rotations).toEqual([]);
    expect(after.token).toBe('pinned-token');
    expect(after.connectUrl).toBe(before.connectUrl);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

// ---- The critical integration assertion: the QR the desktop emits is EXACTLY
// what the shipped mobile app accepts. We import the app's own parser and feed
// it the connectUrl the gateway built. -------------------------------------
describe('QR ↔ mobile app round-trip', () => {
  it('the gateway connectUrl parses cleanly via the app splitConnectUrl', async () => {
    const { rt } = makeRuntime({ userData });
    const mgr = new MobileGatewayManager(rt);
    const status = await mgr.start();
    expect(status.connectUrl).toBeTruthy();

    // The mobile app scans this exact string off the QR.
    const parsed = splitConnectUrl(status.connectUrl!);
    // The token round-trips intact…
    expect(parsed.token).toBe(status.token);
    // …and the bare gateway URL is a ws:// address with the bound port and the
    // ?t= credential stripped (the app presents the token via the subprotocol).
    expect(parsed.url).toMatch(/^ws:\/\/[^/]+:8765\/?$/);
    expect(parsed.url).not.toContain('?');
  });
});
