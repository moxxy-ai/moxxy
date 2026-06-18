/**
 * Runtime discovery of installed desktop mini-apps.
 *
 * A custom/third-party app is a folder under `<appsRoot>/<id>/` (the same
 * `userData/moxxy-apps` root the installer + asset protocol use) containing a
 * `moxxy-app.json` manifest, its `ui/` web bundle, and any downloaded assets.
 * This scans that root, validates each manifest against the SDK schema, and
 * returns the apps the desktop should surface in the gallery — no recompile,
 * no hardcoded registry.
 *
 * Electron-free (mirrors {@link ./installer}) so it unit-tests in plain Node;
 * the caller passes `appsRoot`. Every result is SAFE to trust downstream: the
 * dir name must be a valid slug, it must equal the manifest `id` (so an app
 * can't claim another's id / asset dir), and the manifest must fully validate.
 * A bad app folder is skipped (with its reason) rather than failing the scan, so
 * one broken app never hides the others.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseAppManifest, APP_ID_RE, type AppManifest } from '@moxxy/desktop-app-sdk';

export interface DiscoveredApp {
  readonly manifest: AppManifest;
  /** Absolute app dir (`<appsRoot>/<id>`). */
  readonly dir: string;
}

export interface DiscoverySkip {
  /** The offending folder name. */
  readonly name: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly apps: DiscoveredApp[];
  readonly skipped: DiscoverySkip[];
}

const MANIFEST_FILE = 'moxxy-app.json';
/** A manifest larger than this is certainly malformed; bound the read. */
const MAX_MANIFEST_BYTES = 64 * 1024;

/**
 * Scan `appsRoot` for valid app folders. Returns the discovered apps plus the
 * folders skipped (and why), never throwing for a single bad app. A missing
 * `appsRoot` yields an empty result (no apps installed yet).
 */
export async function discoverApps(appsRoot: string): Promise<DiscoveryResult> {
  let entries: string[];
  try {
    entries = await readdir(appsRoot);
  } catch {
    return { apps: [], skipped: [] }; // root not created yet
  }

  const apps: DiscoveredApp[] = [];
  const skipped: DiscoverySkip[] = [];

  for (const name of entries) {
    // Only ever consider strict-slug dirs — the same constraint the id, the
    // asset dir, and the `moxxy-app://` host segment all share.
    if (!APP_ID_RE.test(name)) continue;
    const dir = path.join(appsRoot, name);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = path.join(dir, MANIFEST_FILE);
    let raw: string;
    try {
      const info = await stat(manifestPath);
      if (!info.isFile()) continue; // a plain asset dir, not an app
      if (info.size > MAX_MANIFEST_BYTES) {
        skipped.push({ name, reason: 'manifest too large' });
        continue;
      }
      raw = await readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest here
    }

    const parsed = parseAppManifest(raw);
    if (!parsed.ok) {
      skipped.push({ name, reason: parsed.error });
      continue;
    }
    // The folder name is the authoritative id (it names the asset dir + the
    // `moxxy-app://` host). A manifest claiming a different id is rejected so an
    // app can't masquerade as / serve from another app's directory.
    if (parsed.manifest.id !== name) {
      skipped.push({ name, reason: `manifest id "${parsed.manifest.id}" does not match folder name` });
      continue;
    }
    apps.push({ manifest: parsed.manifest, dir });
  }

  // Deterministic order (gallery stability) — by name.
  apps.sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0));
  return { apps, skipped };
}
