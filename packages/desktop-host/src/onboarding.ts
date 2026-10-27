/**
 * Onboarding probes — purely informational, the renderer uses them
 * to decide whether to render an install / init wizard before the
 * chat surface. The actual save path (`saveProviderKey`) writes the
 * secret into the vault the runner reads (the same store Settings → Vault
 * writes), so encryption stays the vault's responsibility.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { moxxyHome } from '@moxxy/sdk/server';
import type { OnboardingStatus } from '@moxxy/desktop-ipc-contract';
import type { VaultStore } from '@moxxy/plugin-vault';
import { augmentedPaths, resolveMoxxyCli, spawnCli, type CliInvocation } from './cli-resolver';
import { builtinProviderKeyName } from './provider-discovery';
import { assertSafeProviderName } from './security';

export async function probeOnboarding(): Promise<OnboardingStatus> {
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  const cliInstalled = cli !== null;
  const cliPath = cli ? displayPath(cli) : null;

  // The CLI/runner store the vault + config under moxxyHome() — which honors
  // $MOXXY_HOME. Reading a hardcoded ~/.moxxy here would miss a relocated home
  // and report hasProvider:false even when a key is configured, looping the
  // onboarding wizard forever.
  const dir = moxxyHome();
  const activeProvider = await readActiveProviderAt(dir);
  const vaultKeys = await readVaultKeysAt(dir);

  const expectedKey = activeProvider ? builtinProviderKeyName(activeProvider) : null;
  const hasProvider =
    activeProvider !== null &&
    expectedKey !== null &&
    vaultKeys.includes(expectedKey);

  return { cliInstalled, cliPath, hasProvider, activeProvider };
}

/**
 * Read the active provider (`plugins.provider.default`) directly from the
 * unified `config.yaml` in a `.moxxy` directory — the store that replaced
 * `preferences.json`. Read directly (not via @moxxy/config) to keep the
 * Electron main bundle free of the config loader's heavier import graph.
 */
async function readActiveProviderAt(moxxyDir: string): Promise<string | null> {
  try {
    const body = await readFile(path.join(moxxyDir, 'config.yaml'), 'utf8');
    const cfg = parseYaml(body) as { plugins?: { provider?: { default?: string } } } | null;
    const plugins = cfg?.plugins;
    const provider = plugins?.provider;
    return provider?.default ?? null;
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
 * Store the secret in the vault as `<NAME>_API_KEY`. We never persist or log
 * the value ourselves; the vault owns its encryption and keychain integration.
 * (This used to pipe it into `moxxy vault set`, a command the CLI does not
 * have.)
 */
export async function saveProviderKey(
  provider: string,
  secret: string,
  vault: Pick<VaultStore, 'set'>,
): Promise<void> {
  assertSafeProviderName(provider);
  await vault.set(builtinProviderKeyName(provider), secret);
}

/**
 * Install + configure a non-bundled provider on demand via the CLI's headless
 * provisioner (`moxxy provision --provider <slug> [--model <id>]`). The slim
 * kernel bundles only the OAuth providers; every API-key provider (anthropic,
 * openai, …) lives on npm and must be installed before any runner can activate
 * it. The key was already stored by {@link saveProviderKey}, so provision only
 * installs + enables the package and writes `plugins.provider.default`. The
 * caller restarts the runner so the new package is discovered and activated.
 * Args are passed as argv (no shell), so the bounded `model` can't inject.
 */
export async function provisionProvider(provider: string, model?: string): Promise<void> {
  assertSafeProviderName(provider);
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('moxxy CLI not found');
  const args = ['provision', '--provider', provider];
  if (model) args.push('--model', model);
  await runCli(cli, args);
}

function runCli(cli: CliInvocation, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // No input to give: close stdin at once so a prompt can never hang it.
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
    child.stdin?.end();
  });
}

function displayPath(cli: CliInvocation): string {
  return cli.kind === 'direct' ? cli.bin : cli.entry;
}
