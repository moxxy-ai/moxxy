import { promises as fs } from 'node:fs';
import { createMutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { type Document, isMap, parseDocument } from 'yaml';
import { PLUGIN_CATEGORY_KEYS, type PluginCategoryKey } from './plugins-tree-schema.js';
import { type PluginSettings, pluginSettingsSchema } from './plugin-settings-schema.js';

/**
 * Comment-preserving writers for the user's `~/.moxxy/config.yaml` — the single
 * source of truth for the unified `plugins:` manifest. Runtime quick-switches
 * (the TUI `/model` `/mode` pickers, the runner's provider switch, channel
 * onboarding) persist here through these helpers, which edit the parsed YAML
 * Document in place so user comments and unmodeled keys survive the round-trip.
 *
 * This REPLACES the old `~/.moxxy/preferences.json`: the persisted provider /
 * mode / model / disabled-set now live in the same tree the rest of the config
 * uses (`plugins.provider.default`, `plugins.mode.default`,
 * `plugins.provider.items.<name>.{model,enabled}`), so there is no second store
 * to reconcile.
 */

/**
 * Per-instance mutex serializing the read-modify-write of `config.yaml`. The
 * atomic write prevents torn files, but two concurrent writers would otherwise
 * read the same baseline and the second would clobber the first. Cross-process
 * races (CLI vs running session) remain best-effort behind the atomic rename.
 */
const configMutex = createMutex();

export interface UserConfigOptions {
  readonly configPath?: string;
}

export function defaultUserConfigPath(): string {
  return moxxyPath('config.yaml');
}

// --- package enable/disable ledger (plugins.packages.<pkg>) ---------------

export async function loadDisabledPackageNames(
  opts: UserConfigOptions = {},
): Promise<ReadonlySet<string>> {
  const packages = await readPackagesMap(opts.configPath ?? defaultUserConfigPath());
  const disabled = new Set<string>();
  for (const [packageName, settings] of Object.entries(packages)) {
    if (settings?.enabled === false) disabled.add(packageName);
  }
  return disabled;
}

export async function isPluginDisabled(
  packageName: string,
  opts: UserConfigOptions = {},
): Promise<boolean> {
  return (await loadDisabledPackageNames(opts)).has(packageName);
}

export async function setPluginEnabled(
  packageName: string,
  enabled: boolean,
  opts: UserConfigOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    pluginSettingsSchema.pick({ enabled: true }).parse({ enabled });
    const existing = readRawEntry(doc, ['plugins', 'packages', packageName]);
    doc.setIn(['plugins', 'packages', packageName], { ...existing, enabled });
    await writeUserConfigDoc(configPath, doc);
  });
}

export async function clearPluginState(
  packageName: string,
  opts: UserConfigOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    if (!doc.hasIn(['plugins', 'packages', packageName])) return;
    doc.deleteIn(['plugins', 'packages', packageName]);
    pruneEmpty(doc, ['plugins', 'packages']);
    pruneEmpty(doc, ['plugins']);
    await writeUserConfigDoc(configPath, doc);
  });
}

// --- category default swap (plugins.<category>.default) -------------------

export async function setCategoryDefault(
  category: string,
  name: string,
  opts: UserConfigOptions = {},
): Promise<void> {
  if (!(PLUGIN_CATEGORY_KEYS as ReadonlyArray<string>).includes(category)) {
    throw new Error(
      `unknown plugin category '${category}' (expected one of: ${PLUGIN_CATEGORY_KEYS.join(', ')})`,
    );
  }
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    doc.setIn(['plugins', category as PluginCategoryKey, 'default'], name);
    await writeUserConfigDoc(configPath, doc);
  });
}

// --- provider item options (plugins.provider.items.<name>.{model,enabled}) -

/** Persist the active model for a provider (`plugins.provider.items.<name>.model`). */
export async function setProviderModel(
  providerName: string,
  model: string,
  opts: UserConfigOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    doc.setIn(['plugins', 'provider', 'items', providerName, 'model'], model);
    await writeUserConfigDoc(configPath, doc);
  });
}

/** Enable/disable a provider (`plugins.provider.items.<name>.enabled`). */
export async function setProviderEnabled(
  providerName: string,
  enabled: boolean,
  opts: UserConfigOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    doc.setIn(['plugins', 'provider', 'items', providerName, 'enabled'], enabled);
    await writeUserConfigDoc(configPath, doc);
  });
}

// --- first-run wizard (moxxy init) ----------------------------------------

/** The subset of `moxxy init` selections that map onto the unified config tree. */
export interface InitConfigSelections {
  /** Active provider contribution name (`plugins.provider.default`). */
  readonly provider: string;
  /** Default model for the provider (`plugins.provider.items.<name>.model`). */
  readonly model?: string | null;
  /** Ordered fallback provider names (`plugins.provider.fallbacks`); the primary is dropped. */
  readonly fallbacks?: ReadonlyArray<string>;
  /** Loop strategy (`plugins.mode.default`). */
  readonly mode: string;
  /** Memory embedder (`plugins.embedder.default`); the `tfidf` floor is left unwritten. */
  readonly embedder: string;
  /** Opt-in plugin-security toggle (top-level `security.enabled`). */
  readonly security?: { readonly enabled: boolean };
}

/**
 * Persist the interactive `moxxy init` wizard's selections into
 * `~/.moxxy/config.yaml` — the same store `moxxy provision` and the runtime
 * quick-switches write, so init no longer drops a legacy-shaped file in the
 * project cwd that the clean-slate schema silently ignores.
 *
 * One atomic read-modify-write over the parsed Document, so the package ledger
 * the wizard already wrote (enabling the provider + extra packages via
 * {@link setPluginEnabled}) and any user comments survive the merge. Like
 * `provision`, the provider's API key lives in the vault under its canonical
 * name and the credential resolver finds it there — so no `${vault:...}` ref is
 * written here.
 */
export async function applyInitConfig(
  sel: InitConfigSelections,
  opts: UserConfigOptions = {},
): Promise<string> {
  const configPath = opts.configPath ?? defaultUserConfigPath();
  await configMutex.run(async () => {
    const doc = await readUserConfigDoc(configPath);
    doc.setIn(['plugins', 'provider', 'default'], sel.provider);
    if (sel.model) {
      doc.setIn(['plugins', 'provider', 'items', sel.provider, 'model'], sel.model);
    }
    const fallbacks = (sel.fallbacks ?? []).filter((f) => f !== sel.provider);
    if (fallbacks.length > 0) {
      doc.setIn(['plugins', 'provider', 'fallbacks'], doc.createNode(fallbacks));
    }
    doc.setIn(['plugins', 'mode', 'default'], sel.mode);
    // tfidf is the built-in floor — only persist a non-default embedder.
    if (sel.embedder && sel.embedder !== 'tfidf') {
      doc.setIn(['plugins', 'embedder', 'default'], sel.embedder);
    }
    if (sel.security?.enabled) {
      doc.setIn(['security', 'enabled'], true);
    }
    await writeUserConfigDoc(configPath, doc);
  });
  return configPath;
}

/**
 * The persisted active model — the default provider's `model` item option
 * (`plugins.provider.items.<default>.model`). The user-level equivalent of the
 * old `preferences.model`; used by the TUI as the effective model when no
 * `--model` flag is passed. Returns undefined when unset.
 */
export async function loadActiveModel(opts: UserConfigOptions = {}): Promise<string | undefined> {
  const doc = await readUserConfigDoc(opts.configPath ?? defaultUserConfigPath());
  const provider = doc.getIn(['plugins', 'provider', 'default']);
  if (typeof provider !== 'string') return undefined;
  const model = doc.getIn(['plugins', 'provider', 'items', provider, 'model']);
  return typeof model === 'string' ? model : undefined;
}

/** The active provider contribution name (`plugins.provider.default`), or null. */
export async function loadActiveProvider(opts: UserConfigOptions = {}): Promise<string | null> {
  const doc = await readUserConfigDoc(opts.configPath ?? defaultUserConfigPath());
  const provider = doc.getIn(['plugins', 'provider', 'default']);
  return typeof provider === 'string' ? provider : null;
}

/** Provider names disabled via `plugins.provider.items.<name>.enabled: false`. */
export async function loadDisabledProviders(
  opts: UserConfigOptions = {},
): Promise<ReadonlyArray<string>> {
  const doc = await readUserConfigDoc(opts.configPath ?? defaultUserConfigPath());
  const items = doc.getIn(['plugins', 'provider', 'items']);
  if (!isMap(items)) return [];
  const out: string[] = [];
  for (const [name, entry] of Object.entries(items.toJSON() as Record<string, unknown>)) {
    if (entry && typeof entry === 'object' && (entry as { enabled?: unknown }).enabled === false) {
      out.push(name);
    }
  }
  return out;
}

// --- shared YAML round-trip helpers ---------------------------------------

/**
 * Parse `config.yaml` into a yaml Document, preserving comments and untouched
 * keys for the write path. A malformed file degrades to an empty document
 * rather than throwing, so a single hand-edit typo can't strand every writer.
 * The bad file is left in place for the user to inspect.
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
        'treating as empty',
    );
    return parseDocument('');
  }
  return doc;
}

async function writeUserConfigDoc(configPath: string, doc: Document): Promise<void> {
  await writeFileAtomic(configPath, doc.toString());
}

/** Read the validated `plugins.packages` map for the read-only paths. */
async function readPackagesMap(configPath: string): Promise<Record<string, PluginSettings>> {
  const doc = await readUserConfigDoc(configPath);
  const packages = doc.getIn(['plugins', 'packages']);
  if (!isMap(packages)) return {};
  const out: Record<string, PluginSettings> = {};
  for (const [key, entry] of Object.entries(packages.toJSON() as Record<string, unknown>)) {
    const parsed = pluginSettingsSchema.safeParse(entry);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

/** A node as plain JS (unvalidated), or {} when absent/non-object. */
function readRawEntry(doc: Document, path: ReadonlyArray<string>): Record<string, unknown> {
  const node = doc.getIn(path, false);
  if (!isMap(node)) return {};
  const raw = node.toJSON() as unknown;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Delete an emptied map node so we don't leave a bare `plugins: { packages: {} }`. */
function pruneEmpty(doc: Document, path: ReadonlyArray<string>): void {
  const node = doc.getIn(path);
  if (isMap(node) && node.items.length === 0) doc.deleteIn(path);
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}
