import { promises as fs } from 'node:fs';
import { type PluginSettings, pluginSettingsSchema } from '@moxxy/config';
import { createMutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { type Document, isMap, parseDocument } from 'yaml';

/**
 * Per-instance mutex serializing the read-modify-write of `config.yaml`. The
 * atomic write prevents torn files, but two concurrent enable/disable calls
 * would otherwise read the same baseline and the second would clobber the
 * first's flag. Mirrors plugin-mcp/config-io.ts and provider-admin/store.ts.
 * Cross-process races (CLI vs running session) remain best-effort behind the
 * atomic rename.
 */
const configMutex = createMutex();

/**
 * Enable/disable persistence for plugins. A disabled plugin is recorded as
 * `plugins[packageName].enabled = false` in `~/.moxxy/config.yaml`; the CLI's
 * boot-time registration and the PluginHost's reload predicate both honor it,
 * so a disable survives restarts and a reload never resurrects it. Formerly
 * `@moxxy/plugin-marketplace/config-state`; folded here next to install/remove.
 */
export interface PluginConfigOptions {
  readonly configPath?: string;
}

export function defaultUserConfigPath(): string {
  return moxxyPath('config.yaml');
}

export async function loadDisabledPackageNames(
  opts: PluginConfigOptions = {},
): Promise<ReadonlySet<string>> {
  const plugins = await readPluginsMap(opts.configPath ?? defaultUserConfigPath());
  const disabled = new Set<string>();
  for (const [packageName, settings] of Object.entries(plugins)) {
    if (settings?.enabled === false) disabled.add(packageName);
  }
  return disabled;
}

export async function isPluginDisabled(
  packageName: string,
  opts: PluginConfigOptions = {},
): Promise<boolean> {
  return (await loadDisabledPackageNames(opts)).has(packageName);
}

export async function setPluginEnabled(
  packageName: string,
  enabled: boolean,
  opts: PluginConfigOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    // Edit in place on the parsed Document so user comments and any config
    // keys this package doesn't model are preserved across the round-trip.
    // Merge into the RAW existing entry (not the validated one) so per-plugin
    // extras the schema doesn't model survive; validate only the value we set.
    pluginSettingsSchema.pick({ enabled: true }).parse({ enabled });
    const existing = readRawPluginEntry(doc, packageName);
    doc.setIn(['plugins', packageName], { ...existing, enabled });
    await writeUserConfigDoc(configPath, doc);
  });
}

export async function clearPluginState(
  packageName: string,
  opts: PluginConfigOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    if (!doc.hasIn(['plugins', packageName])) return;
    doc.deleteIn(['plugins', packageName]);
    // Drop an emptied `plugins` map rather than leaving a bare `plugins: {}`.
    const plugins = doc.get('plugins');
    if (isMap(plugins) && plugins.items.length === 0) doc.delete('plugins');
    await writeUserConfigDoc(configPath, doc);
  });
}

/**
 * Parse `config.yaml` into a yaml Document, preserving comments and untouched
 * keys for the write path. A malformed file degrades to an empty document
 * rather than throwing — mirrors plugin-mcp/config-io's degrade-to-empty so a
 * single hand-edit typo can't strand every plugin toggle (and the boot-time
 * disabled-set gate). The bad file is left in place for the user to inspect.
 */
async function readUserConfigDoc(configPath: string): Promise<Document> {
  let raw = '';
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return parseDocument('');
    throw err;
  }
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    console.warn(
      `moxxy: ignoring unparseable user config at ${configPath} (${doc.errors[0]?.message}); ` +
        'treating as no disabled plugins',
    );
    return parseDocument('');
  }
  return doc;
}

async function writeUserConfigDoc(configPath: string, doc: Document): Promise<void> {
  await writeFileAtomic(configPath, doc.toString());
}

/**
 * Read just the validated `plugins` map for the read-only paths. Drops only
 * the offending row on a bad entry (mirrors plugin-mcp) instead of failing the
 * whole map, so one malformed plugin setting can't hide the disabled flag of
 * the others.
 */
async function readPluginsMap(configPath: string): Promise<Record<string, PluginSettings>> {
  const doc = await readUserConfigDoc(configPath);
  const plugins = doc.get('plugins');
  if (!isMap(plugins)) return {};
  const out: Record<string, PluginSettings> = {};
  for (const [key, entry] of Object.entries(plugins.toJSON() as Record<string, unknown>)) {
    const parsed = pluginSettingsSchema.safeParse(entry);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

/** The plugin entry as plain JS (unvalidated), or {} when absent/non-object. */
function readRawPluginEntry(doc: Document, packageName: string): Record<string, unknown> {
  const node = doc.getIn(['plugins', packageName], false);
  if (!isMap(node)) return {};
  const raw = node.toJSON() as unknown;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}
