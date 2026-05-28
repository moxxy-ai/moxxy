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
    expect(normalizeTunnelName('Cloudflared')).toBe('cloudflared');
    expect(normalizeTunnelName('ngrok')).toBe('ngrok');
  });

  it('returns undefined / {} when the file is missing', () => {
    expect(readTunnelSetting(file)).toBeUndefined();
    expect(readWebSettings(file)).toEqual({});
  });

  it('round-trips a written setting (normalized)', async () => {
    await writeTunnelSetting('cloudflared', file);
    expect(readTunnelSetting(file)).toBe('cloudflared');
    await writeTunnelSetting('none', file);
    expect(readTunnelSetting(file)).toBe('localhost');
  });

  it('tolerates a corrupt file', async () => {
    await writeTunnelSetting('ngrok', file);
    // overwrite with garbage
    rmSync(file);
    expect(readTunnelSetting(file)).toBeUndefined();
  });
});
