import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { moxxyPackageSchema, type PluginSetupField, type PluginSetupSpec } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';

// Same location install.ts manages; resolved directly (not imported from
// install.ts) so install → setup-spec stays acyclic.
const userPluginsDir = (): string => moxxyPath('plugins');

/**
 * Read a plugin's declarative setup step (`package.json#moxxy.setup`) from
 * its INSTALLED location under `~/.moxxy/plugins` — no plugin code executes.
 * Returns null when the package isn't installed or declares no setup.
 * (Kernel-bundled plugins have no on-disk package.json; none declare setup.)
 */
export async function readPluginSetup(packageName: string): Promise<PluginSetupSpec | null> {
  const pkgJson = path.join(userPluginsDir(), 'node_modules', packageName, 'package.json');
  let raw: string;
  try {
    raw = await fs.readFile(pkgJson, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = moxxyPackageSchema.safeParse(JSON.parse(raw)?.moxxy ?? {});
    return parsed.success ? (parsed.data.setup ?? null) : null;
  } catch {
    return null;
  }
}

/** Every user-scope installed package (name → setup spec) that declares one. */
export async function listPluginSetups(): Promise<
  ReadonlyArray<{ packageName: string; setup: PluginSetupSpec }>
> {
  const modules = path.join(userPluginsDir(), 'node_modules');
  let names: string[] = [];
  try {
    for (const entry of await fs.readdir(modules)) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        for (const sub of await fs.readdir(path.join(modules, entry))) {
          if (!sub.startsWith('.')) names.push(`${entry}/${sub}`);
        }
      } else {
        names.push(entry);
      }
    }
  } catch {
    return [];
  }
  const out: Array<{ packageName: string; setup: PluginSetupSpec }> = [];
  for (const name of names) {
    const setup = await readPluginSetup(name);
    if (setup) out.push({ packageName: name, setup });
  }
  return out;
}

/** Canonical vault entry name for a secret field: explicit `vaultKey`, else
 *  `<PKG>_<KEY>` upper-snake (scope stripped: `@moxxy/plugin-x` → `PLUGIN_X`). */
export function setupFieldVaultKey(packageName: string, field: PluginSetupField): string {
  if (field.vaultKey) return field.vaultKey;
  const pkg = packageName.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9]+/g, '_');
  return `${pkg}_${field.key}`.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/** The vault slice setup writes need (structural — implemented by the CLI's
 *  VaultStore; kept here so both the init wizard and the TUI's post-install
 *  dialog share ONE write implementation). */
export interface SetupSpecVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, tags?: ReadonlyArray<string>): Promise<void>;
}

export type SetupFieldValue = string | boolean;

export interface ApplySetupOptions {
  readonly vault: SetupSpecVault;
  readonly cwd: string;
  readonly packageName: string;
  readonly setup: PluginSetupSpec;
  /** Collected values keyed by field key. Missing keys are left untouched. */
  readonly values: Readonly<Record<string, SetupFieldValue>>;
  /** Injectable config writer (tests). Defaults to @moxxy/config setConfigValue. */
  readonly writeConfig?: (path: string, value: unknown) => Promise<void>;
}

export interface ApplySetupResult {
  /** True when every required field now has a value (written or pre-existing). */
  readonly complete: boolean;
  /** Required field keys still unsatisfied. */
  readonly missing: ReadonlyArray<string>;
}

/**
 * Persist collected setup values — THE single write implementation behind
 * every frontend (init wizard, TUI dialog, /setup): secrets go to the vault
 * and the plugin's `options.<key>` gets a `${vault:<name>}` ref (resolved at
 * boot, never plaintext); other kinds land at
 * `plugins.packages.<pkg>.options.<key>` via the shared validated writer.
 * Completeness counts a required secret as satisfied when the vault already
 * holds it (re-runs / enter-to-keep).
 */
export async function applySetupValues(opts: ApplySetupOptions): Promise<ApplySetupResult> {
  const writeConfig =
    opts.writeConfig ??
    (async (path: string, value: unknown) => {
      const { setConfigValue } = await import('@moxxy/config');
      await setConfigValue({ scope: 'user', cwd: opts.cwd, path, value });
    });

  const missing: string[] = [];
  for (const field of opts.setup.fields) {
    const optionsPath = `plugins.packages.${opts.packageName}.options.${field.key}`;
    const provided = opts.values[field.key];

    if (field.kind === 'secret') {
      const vaultKey = setupFieldVaultKey(opts.packageName, field);
      if (typeof provided === 'string' && provided.trim().length > 0) {
        await opts.vault.set(vaultKey, provided.trim(), [opts.packageName]);
        await writeConfig(optionsPath, `\${vault:${vaultKey}}`);
      } else if (field.required !== false) {
        const existing = await opts.vault.get(vaultKey).catch(() => null);
        if (!existing) missing.push(field.key);
      }
      continue;
    }

    if (provided !== undefined && provided !== '') {
      await writeConfig(optionsPath, provided);
    } else if (field.required !== false) {
      missing.push(field.key);
    }
  }
  return { complete: missing.length === 0, missing };
}
