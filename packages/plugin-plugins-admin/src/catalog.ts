/**
 * Curated catalog of installable plugins plus the pure helpers the
 * `moxxy plugins` CLI and the TUI `/plugins` picker use to render install /
 * enable / disable / remove choices. Formerly `@moxxy/plugin-marketplace`;
 * folded here so plugin install + lifecycle live in one package.
 */
export interface PluginCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly packageName: string;
  readonly installSpec: string;
  readonly startCommand?: string;
  readonly defaultPort?: number;
  readonly kind?: 'ui' | 'runtime' | 'cli';
}

export interface PluginPickerOption {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}

export type PluginAction = 'install' | 'open' | 'enable' | 'disable' | 'remove' | 'back';

export interface PluginActionOption {
  readonly value: PluginAction;
  readonly label: string;
  readonly hint: string;
}

export type PluginCatalogStatus = 'not installed' | 'installed' | 'disabled';

/** Built-in, curated list of installable plugins. Users can also install any
 *  npm package / GitHub spec / local path directly by name. */
export const INSTALLABLE_PLUGIN_CATALOG: ReadonlyArray<PluginCatalogEntry> = [
  {
    id: 'virtual-office',
    label: 'Virtual Office',
    description: 'Pixel-art UI for running Moxxy with an office view and session picker.',
    packageName: '@moxxy/virtual-office-plugin',
    installSpec: 'github:moxxy-ai/virtual-office-plugin#main',
    startCommand: 'moxxy plugins open virtual-office',
    defaultPort: 17901,
    kind: 'ui',
  },
];

export function resolveCatalogEntry(
  target: string,
  catalog: ReadonlyArray<PluginCatalogEntry> = INSTALLABLE_PLUGIN_CATALOG,
): PluginCatalogEntry | undefined {
  return catalog.find((entry) => entry.id === target || entry.packageName === target);
}

export function resolveCatalogPackageName(
  target: string,
  catalog: ReadonlyArray<PluginCatalogEntry> = INSTALLABLE_PLUGIN_CATALOG,
): string {
  return resolveCatalogEntry(target, catalog)?.packageName ?? target;
}

export function buildPluginCatalogOptions(input: {
  readonly catalog: ReadonlyArray<PluginCatalogEntry>;
  readonly installedPackageNames: ReadonlySet<string>;
  readonly disabledPackageNames: ReadonlySet<string>;
}): PluginPickerOption[] {
  return input.catalog.map((entry) => ({
    value: entry.id,
    label: entry.label,
    hint: formatPluginCatalogStatus(entry, input.installedPackageNames, input.disabledPackageNames),
  }));
}

export function buildPluginActionOptions(input: {
  readonly entry: PluginCatalogEntry;
  readonly installedPackageNames: ReadonlySet<string>;
  readonly disabledPackageNames: ReadonlySet<string>;
}): PluginActionOption[] {
  const installed = input.installedPackageNames.has(input.entry.packageName);
  const disabled = input.disabledPackageNames.has(input.entry.packageName);
  const options: PluginActionOption[] = [];
  if (!installed) {
    options.push({
      value: 'install',
      label: 'Install',
      hint: input.entry.installSpec,
    });
  } else if (disabled) {
    options.push({
      value: 'enable',
      label: 'Enable',
      hint: 'allow this plugin to run',
    });
    options.push({
      value: 'remove',
      label: 'Remove',
      hint: 'uninstall from ~/.moxxy/plugins',
    });
  } else {
    if (input.entry.kind === 'ui') {
      options.push({
        value: 'open',
        label: 'Open',
        hint: input.entry.startCommand ?? `moxxy plugins open ${input.entry.id}`,
      });
    }
    options.push({
      value: 'disable',
      label: 'Disable',
      hint: 'keep installed, but block startup',
    });
    options.push({
      value: 'remove',
      label: 'Remove',
      hint: 'uninstall from ~/.moxxy/plugins',
    });
  }
  options.push({
    value: 'back',
    label: 'Back',
    hint: 'return without changes',
  });
  return options;
}

export function formatPluginCatalogStatus(
  entry: PluginCatalogEntry,
  installedPackageNames: ReadonlySet<string>,
  disabledPackageNames: ReadonlySet<string>,
): string {
  if (!installedPackageNames.has(entry.packageName)) return `not installed · ${entry.installSpec}`;
  if (disabledPackageNames.has(entry.packageName)) return 'disabled';
  return entry.startCommand ? `installed · ${entry.startCommand}` : 'installed';
}

export function buildInstallSpec(input: {
  readonly target: string;
  readonly version?: string;
  readonly ref?: string;
  readonly catalog?: ReadonlyArray<PluginCatalogEntry>;
}): string {
  const entry = resolveCatalogEntry(input.target, input.catalog);
  const base = entry?.installSpec ?? input.target;
  const withRef = input.ref ? applyGitRef(base, input.ref) : base;
  if (entry || input.ref || isGitLikeSpec(withRef) || isPathLikeSpec(withRef)) return withRef;
  return input.version ? `${withRef}@${input.version}` : withRef;
}

export function applyGitRef(spec: string, ref: string): string {
  const trimmed = ref.replace(/^#/, '');
  if (trimmed.length === 0) return spec;
  return spec.replace(/#.*$/, '') + `#${trimmed}`;
}

function isGitLikeSpec(spec: string): boolean {
  return (
    spec.startsWith('github:') ||
    spec.startsWith('git+') ||
    spec.startsWith('https://') ||
    spec.startsWith('ssh://') ||
    spec.includes('.git#')
  );
}

function isPathLikeSpec(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~');
}
