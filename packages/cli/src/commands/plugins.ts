import {
  INSTALLABLE_PLUGIN_CATALOG,
  buildInstallSpec,
  clearPluginState,
  formatPluginCatalogStatus,
  installPluginPackage,
  loadDisabledPackageNames,
  removePluginPackage,
  resolveCatalogEntry,
  resolveCatalogPackageName,
  searchInstallablePlugins,
  setCategoryDefault,
  setPluginEnabled,
} from '@moxxy/plugin-plugins-admin';
import type { ParsedArgv } from '../argv.js';
import { argvToSetupOptions, bootSession, helpRequested } from '../argv-helpers.js';
import { probeSession } from '../setup.js';
import { isCriticalPackage } from '../setup/critical-packages.js';
import { printError } from '../errors.js';
import { runPluginNewCommand } from './plugin-new.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy plugins',
  tagline: 'install, enable/disable, and manage plugins',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'list loaded + disabled plugins and the install catalog'],
        ['search <query>', 'search npm + catalog for installable plugins'],
        ['install <spec> [--version v] [--ref r]', 'install from catalog id, npm, GitHub, or path'],
        ['remove <pkg>', 'uninstall a plugin package'],
        ['enable <pkg>', 'enable (plug in) a plugin'],
        ['disable <pkg>', 'disable (unplug) a plugin — kept installed'],
        ['defaults', 'show each category’s active default + swappable options'],
        ['set-default <category> <name>', 'swap a category default (e.g. provider openai)'],
        ['open <id>', 'show how to open a UI plugin'],
        ['reload', 'rescan discovery roots and hot-reload'],
        ['new <name> [--here]', 'scaffold a new user-scope plugin'],
      ],
    },
  ],
});

export async function runPluginsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'help' || helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  switch (sub) {
    case 'new':
      return await runPluginNewCommand(argv);
    case 'list':
      return await runList(argv);
    case 'search':
      return await runSearch(argv);
    case 'reload':
      return await runReload(argv);
    case 'install':
    case 'add':
      return await runInstall(argv);
    case 'remove':
    case 'uninstall':
      return await runRemove(argv);
    case 'enable':
      return await runToggle(argv, true);
    case 'disable':
      return await runToggle(argv, false);
    case 'defaults':
      return await runDefaults(argv);
    case 'set-default':
      return await runSetDefault(argv);
    case 'open':
      return runOpen(argv);
    default:
      printError(`unknown 'plugins' subcommand: ${sub}\n${HELP}`);
      return 2;
  }
}

async function runList(argv: ParsedArgv): Promise<number> {
  // Pure registry read — probe semantics (no init-hook daemons, session
  // closed before we print). Plugin packages register before init hooks,
  // so the listing is identical to a full boot's.
  const loaded = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    }),
    ({ session }) => session.pluginHost.list(),
  );
  const disabled = await loadDisabledPackageNames();
  // "Installed" for catalog status = anything the host knows about: loaded
  // plugins plus disabled-but-present ones.
  const installed = new Set<string>([...loaded.map((p) => p.name), ...disabled]);

  const nameCol = Math.max(8, ...loaded.map((p) => p.name.length), ...[...disabled].map((n) => n.length));
  process.stdout.write(colors.bold('Loaded\n'));
  for (const p of loaded) {
    process.stdout.write(`  ${p.name.padEnd(nameCol)}  ${colors.dim('@' + p.version)}\n`);
  }
  if (disabled.size > 0) {
    process.stdout.write(colors.bold('\nDisabled\n'));
    for (const name of disabled) {
      process.stdout.write(`  ${name.padEnd(nameCol)}  ${colors.dim('(enable with: moxxy plugins enable ' + name + ')')}\n`);
    }
  }
  if (INSTALLABLE_PLUGIN_CATALOG.length > 0) {
    process.stdout.write(colors.bold('\nInstallable\n'));
    for (const entry of INSTALLABLE_PLUGIN_CATALOG) {
      const status = formatPluginCatalogStatus(entry, installed, disabled);
      process.stdout.write(`  ${entry.id.padEnd(16)} ${colors.dim(status)}\n`);
    }
  }
  return 0;
}

async function runSearch(argv: ParsedArgv): Promise<number> {
  const query = argv.positional.slice(1).join(' ').trim();
  if (!query) {
    printError('plugins search requires a query, e.g. `moxxy plugins search notion`');
    return 2;
  }
  try {
    const results = await searchInstallablePlugins(query);
    if (results.length === 0) {
      process.stdout.write(colors.dim(`no plugins found for "${query}"\n`));
      return 0;
    }
    const nameCol = Math.max(8, ...results.map((r) => r.name.length));
    for (const r of results) {
      const tag = r.source === 'catalog' ? colors.dim(' [catalog]') : '';
      process.stdout.write(
        `${r.name.padEnd(nameCol)}  ${colors.dim('@' + r.version)}${tag}\n` +
          (r.description ? `  ${colors.dim(r.description)}\n` : ''),
      );
    }
    process.stdout.write(colors.dim('\ninstall with: moxxy plugins install <name>\n'));
    return 0;
  } catch (err) {
    printError(errorMessage(err));
    return 1;
  }
}

async function runReload(argv: ParsedArgv): Promise<number> {
  const session = await bootSession(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
  });
  await session.pluginHost.reload();
  process.stdout.write(colors.dim('reload complete') + '\n');
  return 0;
}

async function runInstall(argv: ParsedArgv): Promise<number> {
  const target = argv.positional[1];
  if (!target) {
    printError('plugins install requires a catalog id, npm package, GitHub spec, or path');
    return 2;
  }
  const spec = buildInstallSpec({
    target,
    ...(stringFlag(argv, 'version') ? { version: stringFlag(argv, 'version') } : {}),
    ...(stringFlag(argv, 'ref') ? { ref: stringFlag(argv, 'ref') } : {}),
  });
  const entry = resolveCatalogEntry(target);
  try {
    const result = await installPluginPackage({ packageName: spec });
    process.stdout.write(
      `installed ${entry?.packageName ?? spec}\n` +
        `source: ${result.installed}\nplugins dir: ${result.dir}\n` +
        colors.dim('run `moxxy plugins reload` (or restart) to load it\n'),
    );
    return 0;
  } catch (err) {
    printError(errorMessage(err));
    return 1;
  }
}

async function runRemove(argv: ParsedArgv): Promise<number> {
  const target = argv.positional[1];
  if (!target) {
    printError('plugins remove requires a plugin id or package name');
    return 2;
  }
  const packageName = resolveCatalogPackageName(target);
  try {
    const result = await removePluginPackage({ packageName });
    await clearPluginState(packageName);
    process.stdout.write(`removed ${result.removed}\nplugins dir: ${result.dir}\n`);
    return 0;
  } catch (err) {
    printError(errorMessage(err));
    return 1;
  }
}

async function runToggle(argv: ParsedArgv, enabled: boolean): Promise<number> {
  const target = argv.positional[1];
  if (!target) {
    printError(`plugins ${enabled ? 'enable' : 'disable'} requires a plugin id or package name`);
    return 2;
  }
  const packageName = resolveCatalogPackageName(target);
  if (!enabled && isCriticalPackage(packageName)) {
    printError(
      `${packageName} is a core module and cannot be disabled. ` +
        'Swap the relevant category default instead (e.g. `moxxy plugins set-default mode <other>`).',
    );
    return 2;
  }
  try {
    await setPluginEnabled(packageName, enabled);
    process.stdout.write(
      `${enabled ? 'enabled' : 'disabled'} ${packageName}\n` +
        colors.dim('applies to new sessions; a running TUI applies it immediately via /plugins\n'),
    );
    return 0;
  } catch (err) {
    printError(errorMessage(err));
    return 1;
  }
}

async function runDefaults(argv: ParsedArgv): Promise<number> {
  // Probe semantics — registries are populated by plugin registration, so the
  // category snapshot is identical to a full boot's (no init-hook daemons, no
  // provider activation needed just to list).
  const categories = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      skipProviderActivation: true,
      tolerateNoProvider: true,
    }),
    (r) => r.session.pluginsAdmin?.categories() ?? [],
  );
  if (categories.length === 0) {
    process.stdout.write(colors.dim('no swappable categories available\n'));
    return 0;
  }
  for (const cat of categories) {
    const floorNote = cat.floor ? colors.dim(` [floor: ${cat.floor}]`) : '';
    process.stdout.write(
      `${colors.bold(cat.category.padEnd(16))} ${colors.dim('active=')}${cat.active ?? '(none)'}${floorNote}\n`,
    );
    const items = cat.items
      .map((i) => (i.isDefault ? colors.bold(`${i.name}*`) : colors.dim(i.name)))
      .join(', ');
    if (items) process.stdout.write(`  ${items}\n`);
  }
  return 0;
}

async function runSetDefault(argv: ParsedArgv): Promise<number> {
  const category = argv.positional[1];
  const name = argv.positional[2];
  if (!category || !name) {
    printError('plugins set-default requires <category> <name> (e.g. provider openai)');
    return 2;
  }
  try {
    await setCategoryDefault(category, name);
    process.stdout.write(
      `set ${category} default to ${name}\n` +
        colors.dim('applies to new sessions; a running TUI applies it immediately via /plugins\n'),
    );
    return 0;
  } catch (err) {
    printError(errorMessage(err));
    return 1;
  }
}

function runOpen(argv: ParsedArgv): number {
  const target = argv.positional[1];
  if (!target) {
    printError('plugins open requires a plugin id or package name');
    return 2;
  }
  const entry = resolveCatalogEntry(target);
  if (entry?.startCommand) {
    process.stdout.write(`${entry.startCommand}\n`);
    return 0;
  }
  process.stdout.write(
    `${resolveCatalogPackageName(target)} has no start command — it contributes tools/agents, not a UI.\n`,
  );
  return 0;
}

function stringFlag(argv: ParsedArgv, name: string): string | undefined {
  const value = argv.flags[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
