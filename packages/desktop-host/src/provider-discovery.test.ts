import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Both readStoredProviders and the vault shell-out resolve under homedir().
// Point homedir() at a throwaway dir so the parse paths read our fixtures.
let tmp: string;
vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof import('node:os')>();
  return { ...actual, homedir: () => tmp };
});

import {
  builtinProviderKeyName,
  readAdminProviderNames,
  readAdminProviderDetails,
  fetchProviderModels,
} from './provider-discovery';

/** Emit the unified-tree YAML (`plugins.provider.items`) the CLI's
 *  provider-admin now writes — the store that replaced providers.json.
 *  Accepts the legacy `{providers: [...]}` fixture shape for test brevity;
 *  a non-array `providers` produces a structurally-bogus items node. */
function writeProvidersFile(json: unknown): void {
  const dir = path.join(tmp, '.moxxy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'config.yaml'), providersToYaml(json));
}

function providersToYaml(json: unknown): string {
  const providers = (json as { providers?: unknown })?.providers;
  if (!Array.isArray(providers)) return 'plugins:\n  provider:\n    items: nope\n';
  const items = providers
    .map((p) => {
      const e = p as Record<string, unknown>;
      const models = Array.isArray(e['models'])
        ? (e['models'] as Array<Record<string, unknown>>)
            .map((m) => `            - id: ${String(m['id'])}\n              contextWindow: ${Number(m['contextWindow'] ?? 1000)}`)
            .join('\n')
        : '            []';
      return [
        `      ${String(e['name'])}:`,
        `        model: ${String(e['defaultModel'] ?? '')}`,
        `        config:`,
        `          kind: openai-compat`,
        `          baseURL: ${String(e['baseURL'] ?? '')}`,
        ...(typeof e['envVar'] === 'string' ? [`          envVar: ${e['envVar']}`] : []),
        `          models:`,
        models,
      ].join('\n');
    })
    .join('\n');
  return `plugins:\n  provider:\n    items:\n${items}\n`;
}

const savedMoxxyHome = process.env.MOXXY_HOME;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'provider-discovery-'));
  // Default: no $MOXXY_HOME → moxxyHome() falls to <homedir>/.moxxy (the mocked tmp).
  delete process.env.MOXXY_HOME;
});

afterEach(() => {
  if (savedMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = savedMoxxyHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe('builtinProviderKeyName', () => {
  it('uppercases and hyphen→underscore, suffixing _API_KEY', () => {
    expect(builtinProviderKeyName('openai')).toBe('OPENAI_API_KEY');
    expect(builtinProviderKeyName('openai-codex')).toBe('OPENAI_CODEX_API_KEY');
    expect(builtinProviderKeyName('z-ai')).toBe('Z_AI_API_KEY');
  });
});

describe('readAdminProviderNames', () => {
  it('returns [] when the file is missing', async () => {
    await expect(readAdminProviderNames()).resolves.toEqual([]);
  });

  it('returns [] for a malformed file (degrades, never throws)', async () => {
    const dir = path.join(tmp, '.moxxy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'config.yaml'), '{{{ not yaml');
    await expect(readAdminProviderNames()).resolves.toEqual([]);
  });

  it('returns [] when providers is not an array', async () => {
    writeProvidersFile({ providers: 'nope' });
    await expect(readAdminProviderNames()).resolves.toEqual([]);
  });

  it('lists stored provider names', async () => {
    writeProvidersFile({
      providers: [
        { kind: 'openai-compat', name: 'together', baseURL: 'https://x', defaultModel: 'm', models: [] },
        { kind: 'openai-compat', name: 'openrouter', baseURL: 'https://y', defaultModel: 'm', models: [] },
      ],
    });
    await expect(readAdminProviderNames()).resolves.toEqual(['together', 'openrouter']);
  });

  it('reads providers.json from $MOXXY_HOME, not a hardcoded ~/.moxxy', async () => {
    // The CLI's provider-admin writes providers.json under moxxyHome(); when the
    // user relocates state with $MOXXY_HOME, a hardcoded ~/.moxxy here would miss
    // it entirely (the bug that loops onboarding despite a configured provider).
    const relocated = mkdtempSync(path.join(os.tmpdir(), 'moxxy-home-'));
    try {
      process.env.MOXXY_HOME = relocated;
      // Write ONLY to the relocated home; the default tmp/.moxxy stays empty.
      writeFileSync(
        path.join(relocated, 'config.yaml'),
        providersToYaml({
          providers: [
            { kind: 'openai-compat', name: 'relocated', baseURL: 'https://z', defaultModel: 'm', models: [] },
          ],
        }),
      );
      await expect(readAdminProviderNames()).resolves.toEqual(['relocated']);
    } finally {
      rmSync(relocated, { recursive: true, force: true });
    }
  });
});

describe('readAdminProviderDetails', () => {
  it('keys details by name and derives keyName from the slug', async () => {
    writeProvidersFile({
      providers: [
        {
          kind: 'openai-compat',
          name: 'my-vendor',
          baseURL: 'https://api.example.com',
          defaultModel: 'big',
          models: [{ id: 'big' }, { id: 'small' }],
        },
      ],
    });
    const details = await readAdminProviderDetails();
    const d = details.get('my-vendor');
    expect(d).toBeDefined();
    expect(d?.baseURL).toBe('https://api.example.com');
    expect(d?.defaultModel).toBe('big');
    expect(d?.modelIds).toEqual(['big', 'small']);
    expect(d?.keyName).toBe('MY_VENDOR_API_KEY');
  });

  it('honors an explicit envVar override for keyName', async () => {
    writeProvidersFile({
      providers: [
        {
          kind: 'openai-compat',
          name: 'together',
          baseURL: 'https://x',
          defaultModel: 'm',
          models: [],
          envVar: 'TOGETHER_TOKEN',
        },
      ],
    });
    const d = (await readAdminProviderDetails()).get('together');
    expect(d?.keyName).toBe('TOGETHER_TOKEN');
  });

  it('tolerates a missing models array (empty modelIds)', async () => {
    writeProvidersFile({
      providers: [
        { kind: 'openai-compat', name: 'p', baseURL: 'https://x', defaultModel: 'm' },
      ],
    });
    const d = (await readAdminProviderDetails()).get('p');
    expect(d?.modelIds).toEqual([]);
  });
});

describe('fetchProviderModels', () => {
  it('returns [] for a built-in (not in providers.json) without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchProviderModels('anthropic')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('refuses an http (non-localhost) baseURL — never attaches the key over cleartext', async () => {
    // A poisoned providers.json with a plain-http remote endpoint must NOT
    // trigger the vault read or the fetch — the bearer token would leak in
    // cleartext / to an SSRF target.
    writeProvidersFile({
      providers: [
        {
          kind: 'openai-compat',
          name: 'evil',
          baseURL: 'http://attacker.example',
          defaultModel: 'm',
          models: [],
        },
      ],
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchProviderModels('evil')).rejects.toThrow(/non-https/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects a non-URL baseURL without a network call', async () => {
    writeProvidersFile({
      providers: [
        { kind: 'openai-compat', name: 'broken', baseURL: 'not a url', defaultModel: 'm', models: [] },
      ],
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchProviderModels('broken')).rejects.toThrow(/invalid provider baseurl/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
