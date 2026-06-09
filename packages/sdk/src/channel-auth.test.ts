import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveChannelToken,
  rotateChannelToken,
  encodeWsBearerProtocol,
  tokenFromWsProtocolHeader,
  MOXXY_WS_SUBPROTOCOL,
} from './channel-auth.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moxxy-channel-auth-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveChannelToken', () => {
  it('generates and persists a token (JSON with createdAt, mode 0600)', () => {
    const token = resolveChannelToken({ fileName: 'tok', dir });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const file = path.join(dir, 'tok');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      token: string;
      createdAt: string;
    };
    expect(persisted.token).toBe(token);
    expect(Number.isFinite(Date.parse(persisted.createdAt))).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    // Stable across resolves.
    expect(resolveChannelToken({ fileName: 'tok', dir })).toBe(token);
  });

  it('reads a legacy plain-text token file', () => {
    fs.writeFileSync(path.join(dir, 'tok'), 'legacy-secret\n');
    expect(resolveChannelToken({ fileName: 'tok', dir })).toBe('legacy-secret');
  });

  it('warns (but still returns the token) when the persisted token is stale', () => {
    const createdAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(path.join(dir, 'tok'), JSON.stringify({ token: 'old-secret', createdAt }));
    const warnings: string[] = [];
    const token = resolveChannelToken({ fileName: 'tok', dir, warn: (m) => warnings.push(m) });
    expect(token).toBe('old-secret');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/rotat/i);
  });

  it('does not warn for a fresh token', () => {
    const warnings: string[] = [];
    resolveChannelToken({ fileName: 'tok', dir, warn: (m) => warnings.push(m) });
    resolveChannelToken({ fileName: 'tok', dir, warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });

  it('prefers env, then configured, over the persisted file', () => {
    process.env.MOXXY_TEST_CHANNEL_TOKEN = 'from-env';
    try {
      expect(
        resolveChannelToken({
          fileName: 'tok',
          dir,
          envVar: 'MOXXY_TEST_CHANNEL_TOKEN',
          configured: 'from-config',
        }),
      ).toBe('from-env');
    } finally {
      delete process.env.MOXXY_TEST_CHANNEL_TOKEN;
    }
    expect(resolveChannelToken({ fileName: 'tok', dir, configured: 'from-config' })).toBe(
      'from-config',
    );
  });
});

describe('rotateChannelToken', () => {
  it('replaces the persisted token with a fresh secret', () => {
    const original = resolveChannelToken({ fileName: 'tok', dir });
    const rotated = rotateChannelToken({ fileName: 'tok', dir });
    expect(rotated).not.toBe(original);
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveChannelToken({ fileName: 'tok', dir })).toBe(rotated);
  });

  it('upgrades a legacy plain-text file to the JSON format', () => {
    fs.writeFileSync(path.join(dir, 'tok'), 'legacy-secret');
    rotateChannelToken({ fileName: 'tok', dir });
    const raw = fs.readFileSync(path.join(dir, 'tok'), 'utf8');
    expect(raw.trim().startsWith('{')).toBe(true);
  });
});

describe('ws bearer protocol encoding', () => {
  it('round-trips a hex token', () => {
    const entry = encodeWsBearerProtocol('abc123');
    expect(tokenFromWsProtocolHeader(`${MOXXY_WS_SUBPROTOCOL}, ${entry}`)).toBe('abc123');
  });

  it('round-trips reserved characters and emits only valid HTTP token chars', () => {
    const token = "p@ss w0rd/+='!()*,";
    const entry = encodeWsBearerProtocol(token);
    expect(entry).toMatch(/^[A-Za-z0-9._~%-]+$/);
    expect(tokenFromWsProtocolHeader(entry)).toBe(token);
  });

  it('returns null when no bearer entry is offered', () => {
    expect(tokenFromWsProtocolHeader(undefined)).toBeNull();
    expect(tokenFromWsProtocolHeader(MOXXY_WS_SUBPROTOCOL)).toBeNull();
    expect(tokenFromWsProtocolHeader('')).toBeNull();
  });

  it('returns null for a malformed percent escape', () => {
    expect(tokenFromWsProtocolHeader('moxxy.bearer.%zz')).toBeNull();
  });
});
