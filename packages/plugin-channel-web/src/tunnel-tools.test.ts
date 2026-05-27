import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LifecycleHooks, ToolContext, ToolDef } from '@moxxy/sdk';
import { buildWebChannelPlugin, readTunnelSetting, writeTunnelSetting, type TunnelControls } from './index.js';

const ctx = {} as ToolContext;

/** In-memory tunnel registry for the tools to drive. */
function fakeTunnels(available = new Set(['localhost', 'cloudflared', 'ngrok'])): TunnelControls {
  let active = 'localhost';
  return {
    list: () => ['localhost', 'cloudflared', 'ngrok'],
    active: () => active,
    setActive: (n) => {
      active = n;
    },
    isAvailable: (n) => Promise.resolve(available.has(n)),
  };
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mox-tt-'));
  file = path.join(dir, 'web.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function build(opts: Parameters<typeof buildWebChannelPlugin>[0]) {
  const plugin = buildWebChannelPlugin(opts);
  const tool = (n: string): ToolDef => {
    const t = plugin.tools?.find((x) => x.name === n);
    if (!t) throw new Error(`missing tool ${n}`);
    return t;
  };
  return { plugin, set: tool('web_set_tunnel'), status: tool('web_tunnel_status') };
}

describe('web_tunnel_status', () => {
  it('reports the active provider and options', () => {
    const { status } = build({ tunnels: fakeTunnels(), settingsFile: file });
    expect(status.handler({}, ctx)).toEqual({ active: 'localhost', available: ['none', 'localhost', 'cloudflared', 'ngrok'] });
  });
});

describe('web_set_tunnel', () => {
  it('switches provider, persists, and reports the url via live retunnel', async () => {
    const tunnels = fakeTunnels();
    let retunnelled = 0;
    const { set } = build({
      tunnels,
      settingsFile: file,
      getControls: () => ({
        retunnel: () => {
          retunnelled++;
          return Promise.resolve('https://x.trycloudflare.com/?t=k');
        },
      }),
    });
    const r = (await set.handler({ provider: 'cloudflared' }, ctx)) as { ok: boolean; active: string; url?: string };
    expect(r.ok).toBe(true);
    expect(r.active).toBe('cloudflared');
    expect(r.url).toContain('trycloudflare');
    expect(retunnelled).toBe(1);
    expect(tunnels.active()).toBe('cloudflared');
    expect(readTunnelSetting(file)).toBe('cloudflared');
  });

  it('maps "none" to localhost', async () => {
    const tunnels = fakeTunnels();
    const { set } = build({ tunnels, settingsFile: file });
    const r = (await set.handler({ provider: 'none' }, ctx)) as { active: string };
    expect(r.active).toBe('localhost');
    expect(readTunnelSetting(file)).toBe('localhost');
  });

  it('rejects an unknown provider', async () => {
    const { set } = build({ tunnels: fakeTunnels(), settingsFile: file });
    const r = (await set.handler({ provider: 'wireguard' }, ctx)) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown tunnel/);
  });

  it('rejects an unavailable provider with an install hint and does not persist', async () => {
    const tunnels = fakeTunnels(new Set(['localhost'])); // cloudflared not installed
    const { set } = build({ tunnels, settingsFile: file });
    const r = (await set.handler({ provider: 'cloudflared' }, ctx)) as { ok: boolean; hint?: string };
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/install/i);
    expect(readTunnelSetting(file)).toBeUndefined();
  });
});

describe('onInit applies the persisted / default tunnel', () => {
  const fireInit = (hooks: LifecycleHooks | undefined) => (hooks?.onInit as (() => void) | undefined)?.();

  it('applies a persisted setting on boot', () => {
    writeTunnelSetting('ngrok', file);
    const tunnels = fakeTunnels();
    const { plugin } = build({ tunnels, settingsFile: file });
    fireInit(plugin.hooks);
    expect(tunnels.active()).toBe('ngrok');
  });

  it('falls back to the configured default when nothing is persisted', () => {
    const tunnels = fakeTunnels();
    const { plugin } = build({ tunnels, settingsFile: file, defaultTunnel: 'cloudflared' });
    fireInit(plugin.hooks);
    expect(tunnels.active()).toBe('cloudflared');
  });

  it('keeps the seeded default when neither is set', () => {
    const tunnels = fakeTunnels();
    const { plugin } = build({ tunnels, settingsFile: file });
    fireInit(plugin.hooks);
    expect(tunnels.active()).toBe('localhost');
  });
});
