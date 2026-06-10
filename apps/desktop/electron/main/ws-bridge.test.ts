import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePairingQrPayload } from '../../../mobile/src/pairingQr';
import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';
import type { WebSocketBridgeServer, WebSocketCommandBus } from '@moxxy/ipc-server-ws';
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
      clientCount: () => 0,
    };
    const rotated = rotateWsBridgeToken(userData, fakeServer);
    expect(rotated).not.toBe(original);
    expect(calls).toEqual([rotated]);
    // The next resolve picks up the rotated secret.
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe(rotated);
  });

  it('works without a live server (persists only)', () => {
    const rotated = rotateWsBridgeToken(userData, null);
    expect(resolveWsBridgeConfig(userData)?.authToken).toBe(rotated);
  });
});

// ---- MobileGatewayManager (runtime start/stop/status/rotate) ---------------

/** A fake bridge server that records lifecycle calls without binding a port. */
function makeFakeServer(): {
  server: WebSocketBridgeServer;
  closed: () => boolean;
  rotations: string[];
  setClients: (n: number) => void;
} {
  let isClosed = false;
  let clients = 0;
  const rotations: string[] = [];
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
    clientCount: () => clients,
  };
  return {
    server,
    closed: () => isClosed,
    rotations,
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
    const { rt, startCalls } = makeRuntime({ userData });
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
});

// ---- The critical integration assertion: the QR the desktop emits is EXACTLY
// what the shipped mobile app accepts. We import the app's own parser and feed
// it the connectUrl the gateway built. -------------------------------------
describe('QR ↔ mobile app round-trip', () => {
  it('the gateway connectUrl parses cleanly via the app parsePairingQrPayload', async () => {
    const { rt } = makeRuntime({ userData });
    const mgr = new MobileGatewayManager(rt);
    const status = await mgr.start();
    expect(status.connectUrl).toBeTruthy();

    // The mobile app scans this exact string off the QR.
    const parsed = parsePairingQrPayload(status.connectUrl!);
    // The token round-trips intact…
    expect(parsed.token).toBe(status.token);
    // …and the bare gateway URL is a ws:// address with the bound port and the
    // ?t= credential stripped (the app presents the token via the subprotocol).
    expect(parsed.gatewayUrl).toMatch(/^ws:\/\/[^/]+:8765$/);
    expect(parsed.gatewayUrl).not.toContain('?t=');
  });
});
