import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWsBridgeConfig, rotateWsBridgeToken, wsBridgeTokenFile } from './ws-bridge.js';

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
