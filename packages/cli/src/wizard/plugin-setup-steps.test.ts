import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PluginSetupSpec } from '@moxxy/plugin-plugins-admin';

// clack prompts are TTY-bound; script them per test.
vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  isCancel: (v: unknown) => v === Symbol.for('cancel'),
  log: { step: vi.fn(), message: vi.fn(), warn: vi.fn() },
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

import { confirm, password } from '@clack/prompts';
import { runPluginSetupSteps } from './plugin-setup-steps.js';

let tmp: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-psetup-'));
  prevHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = tmp;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

function fakeVault() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    _store: store,
  };
}

const SPEC: PluginSetupSpec = {
  title: 'HTTP channel auth token',
  required: true,
  fields: [
    { key: 'authToken', label: 'Auth token', kind: 'secret', vaultKey: 'MOXXY_HTTP_TOKEN' },
  ],
};

const list = async () => [{ packageName: '@moxxy/plugin-channel-http', setup: SPEC }];

describe('runPluginSetupSteps', () => {
  it('secret: stores in the vault and writes a ${vault:...} ref to options', async () => {
    vi.mocked(password).mockResolvedValue('tok-123' as never);
    const vault = fakeVault();
    await runPluginSetupSteps({ vault, cwd: tmp, list });
    expect(vault._store.get('MOXXY_HTTP_TOKEN')).toBe('tok-123');
    const cfg = await fs.readFile(path.join(tmp, 'config.yaml'), 'utf8');
    expect(cfg).toContain('authToken: ${vault:MOXXY_HTTP_TOKEN}');
    expect(cfg).not.toContain('tok-123');
  });

  it('required setup left incomplete disables the package', async () => {
    vi.mocked(password).mockResolvedValue(Symbol.for('cancel') as never);
    const vault = fakeVault();
    await runPluginSetupSteps({ vault, cwd: tmp, list });
    const cfg = await fs.readFile(path.join(tmp, 'config.yaml'), 'utf8');
    expect(cfg).toContain('enabled: false');
  });

  it('re-run keeps an existing secret on empty enter (no disable)', async () => {
    vi.mocked(password).mockResolvedValue('' as never);
    const vault = fakeVault();
    await vault.set('MOXXY_HTTP_TOKEN', 'kept');
    await runPluginSetupSteps({ vault, cwd: tmp, list });
    expect(vault._store.get('MOXXY_HTTP_TOKEN')).toBe('kept');
    const cfgExists = await fs
      .readFile(path.join(tmp, 'config.yaml'), 'utf8')
      .catch(() => '');
    expect(cfgExists).not.toContain('enabled: false');
  });

  it('optional setup asks first and skips cleanly on decline', async () => {
    const optional = async () => [
      {
        packageName: '@moxxy/plugin-x',
        setup: { title: 'X', fields: [{ key: 'a', label: 'A', kind: 'string' as const }] },
      },
    ];
    vi.mocked(confirm).mockResolvedValue(false as never);
    const vault = fakeVault();
    await runPluginSetupSteps({ vault, cwd: tmp, list: optional });
    await expect(fs.readFile(path.join(tmp, 'config.yaml'), 'utf8')).rejects.toThrow();
  });

  it('respects the `only` filter (post-install path)', async () => {
    vi.mocked(password).mockResolvedValue('never-asked' as never);
    const vault = fakeVault();
    await runPluginSetupSteps({ vault, cwd: tmp, list, only: ['@moxxy/other'] });
    expect(vault._store.size).toBe(0);
  });
});
