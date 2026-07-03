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
