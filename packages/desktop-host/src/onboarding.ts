/**
 * Onboarding probes — purely informational, the renderer uses them
 * to decide whether to render an install / init wizard before the
 * chat surface. The actual save path (`saveProviderKey`) hands the
 * secret off to the CLI's own `vault set` so encryption stays the
 * CLI's responsibility.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { moxxyHome } from '@moxxy/sdk/server';
import type { OnboardingStatus } from '@moxxy/desktop-ipc-contract';
import { augmentedPaths, resolveMoxxyCli, spawnCli, type CliInvocation } from './cli-resolver';
import { builtinProviderKeyName } from './provider-discovery';
import { assertSafeProviderName } from './security';

export async function probeOnboarding(): Promise<OnboardingStatus> {
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  const cliInstalled = cli !== null;
  const cliPath = cli ? displayPath(cli) : null;

  // The CLI/runner store the vault + preferences under moxxyHome() — which
  // honors $MOXXY_HOME. Reading a hardcoded ~/.moxxy here would miss a relocated
  // home and report hasProvider:false even when a key is configured, looping the
  // onboarding wizard forever.
  const dir = moxxyHome();
  const prefs = await readPreferencesAt(dir);
  const activeProvider = prefs?.providerName ?? null;
  const vaultKeys = await readVaultKeysAt(dir);

  const expectedKey = activeProvider ? builtinProviderKeyName(activeProvider) : null;
  const hasProvider =
    activeProvider !== null &&
    expectedKey !== null &&
    vaultKeys.includes(expectedKey);

  return { cliInstalled, cliPath, hasProvider, activeProvider };
}

interface Preferences {
  providerName?: string;
  model?: string;
  mode?: string;
}

/** Read preferences.json directly from a `.moxxy` directory. */
async function readPreferencesAt(moxxyDir: string): Promise<Preferences | null> {
  try {
    const body = await readFile(path.join(moxxyDir, 'preferences.json'), 'utf8');
    return JSON.parse(body) as Preferences;
  } catch {
    return null;
  }
}

/** Read vault entry names directly from a `.moxxy` directory. */
async function readVaultKeysAt(moxxyDir: string): Promise<string[]> {
  try {
    const body = await readFile(path.join(moxxyDir, 'vault.json'), 'utf8');
    const doc = JSON.parse(body) as { entries?: Record<string, unknown> };
    return Object.keys(doc.entries ?? {});
  } catch {
    return [];
  }
}

/** List vault entry names under `<home>/.moxxy/vault.json`. `home` is the home
 *  directory (not the `.moxxy` dir). Degrades to `[]` on any read/parse error. */
export async function readVaultKeys(home: string): Promise<string[]> {
  return readVaultKeysAt(path.join(home, '.moxxy'));
}

/**
 * Pipe the secret into `moxxy vault set <NAME>_API_KEY`. We never
 * persist or log the value ourselves; the CLI owns its own KDF and
 * keychain integration.
 */
export async function saveProviderKey(provider: string, secret: string): Promise<void> {
  assertSafeProviderName(provider);
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('moxxy CLI not found');
  const key = builtinProviderKeyName(provider);
  await runCli(cli, ['vault', 'set', key], secret);
}

function runCli(cli: CliInvocation, args: string[], stdin?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 'pipe' stdin so we can feed the secret to `vault set`.
    const child = spawnCli(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(' ')} exited ${code ?? 'null'}: ${stderr.trim()}`));
    });
    if (stdin !== undefined) {
      child.stdin?.write(stdin);
      child.stdin?.write('\n');
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

function displayPath(cli: CliInvocation): string {
  return cli.kind === 'direct' ? cli.bin : cli.entry;
}
