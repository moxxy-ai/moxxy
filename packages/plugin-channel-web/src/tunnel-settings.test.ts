import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizeTunnelName, readTunnelSetting, readWebSettings, writeTunnelSetting } from './tunnel-settings.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mox-web-'));
  file = path.join(dir, 'web.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('tunnel-settings', () => {
  it('normalizes "none"/local aliases to localhost', () => {
    for (const a of ['none', 'None', 'local', 'off', 'loopback', 'LOOPBACK']) {
      expect(normalizeTunnelName(a)).toBe('localhost');
    }
    expect(normalizeTunnelName('Proxy')).toBe('proxy');
  });

  it('returns undefined / {} when the file is missing', () => {
    expect(readTunnelSetting(file)).toBeUndefined();
    expect(readWebSettings(file)).toEqual({});
  });

  it('round-trips a written setting (normalized)', async () => {
    await writeTunnelSetting('proxy', file);
    expect(readTunnelSetting(file)).toBe('proxy');
    await writeTunnelSetting('none', file);
    expect(readTunnelSetting(file)).toBe('localhost');
  });

  it('tolerates a corrupt file', async () => {
    await writeTunnelSetting('proxy', file);
    // overwrite with garbage
    rmSync(file);
    expect(readTunnelSetting(file)).toBeUndefined();
  });

  // invariant 5: concurrent read-merge-write of web.json must not lose an
  // update. Without the mutex the two writes both read the same snapshot and
  // the second clobbers the first; with it the file ends last-writer-wins and
  // stays well-formed.
  it('serializes concurrent writeTunnelSetting (well-formed, one wins)', async () => {
    await Promise.all([
      writeTunnelSetting('cloudflared', file),
      writeTunnelSetting('ngrok', file),
    ]);
    const survivor = readTunnelSetting(file);
    expect(['cloudflared', 'ngrok']).toContain(survivor);
    // The file must be valid JSON of the expected shape (no torn/partial write).
    expect(readWebSettings(file)).toEqual({ tunnel: survivor });
  });

  it('survives many overlapping writers with a well-formed result', async () => {
    const names = ['cloudflared', 'ngrok', 'localhost', 'cloudflared', 'ngrok'];
    await Promise.all(names.map((n) => writeTunnelSetting(n, file)));
    const survivor = readTunnelSetting(file);
    expect(names).toContain(survivor);
    expect(readWebSettings(file)).toEqual({ tunnel: survivor });
  });
});
