import {
  INSTALLABLE_PLUGIN_CATALOG,
  buildCapabilityReport,
  buildInstallSpec,
  clearPluginState,
  describeCapabilitySurface,
  formatPluginCatalogStatus,
  installPluginPackagePinned,
  loadDisabledPackageNames,
  packageNameFromSpec,
  removePluginPackage,
  resolveCatalogEntry,
  resolveCatalogPackageName,
  resolveInstallSource,
  searchInstallablePlugins,
  setCategoryDefault,
  setPluginEnabled,
  undeclaredToolsWarning,
  type InstallCapabilityReport,
} from '@moxxy/plugin-plugins-admin';
import { isFirstPartyPackage } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { argvToSetupOptions, bootSession, hasBoolFlag, helpRequested } from '../argv-helpers.js';
import { probeSession } from '../setup.js';
import { isCriticalPackage } from '../setup/critical-packages.js';
import { printError } from '../errors.js';
import { runPluginNewCommand } from './plugin-new.js';
import { colors } from '../colors.js';
import { cliVersion } from '../version.js';
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
        [
          'install <spec> [--version v] [--ref r] [--yes]',
          'install from catalog id, npm, GitHub, or path (--yes: accept a third-party capability surface without prompting)',
        ],
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
  const version = stringFlag(argv, 'version');
  const ref = stringFlag(argv, 'ref');
  // Explicit --version / --ref always wins: skip the signed-registry lookup
  // and pass the user's spec through untouched. Otherwise consult the signed
  // index first (a no-op fallback to the hardcoded catalog while the
  // maintainer key is unprovisioned) — a signed entry contributes its exact,
  // signature-covered version as the pin. Pin precedence:
  // user --version > signed index > cliVersion lockstep > latest.
  const resolved =
    version || ref
      ? undefined
      : await resolveInstallSource(target);
  const spec =
    resolved?.spec ??
    buildInstallSpec({
      target,
      ...(version ? { version } : {}),
      ...(ref ? { ref } : {}),
    });
  const entry = resolveCatalogEntry(target);
  try {
    // Bare first-party specs pin to the CLI version (co-published via the
    // fixed changeset group); a pin that 404s retries latest with a warning.
    // Explicit --version/--ref specs pass through untouched.
    const result = await installPluginPackagePinned({
      packageName: spec,
      ...(resolved?.pinnedVersion ? { pinnedVersion: resolved.pinnedVersion } : {}),
      ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
      onWarn: (msg) => process.stderr.write(colors.dim(msg) + '\n'),
    });
    if (resolved?.origin === 'signed' && resolved.pinnedVersion) {
      process.stdout.write(
        colors.dim(`signed registry pin: ${resolved.packageName}@${resolved.pinnedVersion}\n`),
      );
    }
    process.stdout.write(
      `installed ${resolved?.packageName ?? entry?.packageName ?? spec}\n` +
        `source: ${result.installed}\nplugins dir: ${result.dir}\n` +
        colors.dim('run `moxxy plugins reload` (or restart) to load it\n'),
    );
    return await reviewInstallCapabilities(argv, entry?.packageName ?? packageNameFromSpec(spec));
  } catch (err) {
    printError(errorMessage(err));
    return 1;
  }
}

/**
 * Post-install capability review + consent. Every install gets its combined
 * capability surface printed (first-party included — informational). For a
 * THIRD-PARTY package (outside the `@moxxy/` scope) the surface must be
 * consented to: on a TTY via an explicit confirm defaulting to NO; headless
 * only with `--yes` — otherwise the package is left installed but DISABLED.
 *
 * The consent is post-hoc by design: npm lifecycle scripts have already run
 * by the time we can inspect anything, so what consent actually governs is
 * whether the plugin participates in sessions from here on.
 */
async function reviewInstallCapabilities(
  argv: ParsedArgv,
  packageName: string | undefined,
): Promise<number> {
  if (!packageName) {
    // Git/path specs don't reveal their package name pre-load; nothing to
    // attribute tools to, so no automated review (and nothing to disable).
    process.stdout.write(
      colors.dim(
        "couldn't derive a package name from this spec — skipping capability review; " +
          'inspect it with `moxxy security audit --by-package` after reload\n',
      ),
    );
    return 0;
  }
  const probe = await probeInstalledCapabilities(argv, packageName);
  renderCapabilityReview(packageName, probe);
  if (isFirstPartyPackage(packageName)) return 0;

  // Third-party: explicit consent required to keep it enabled. Acceptance
  // writes an explicit enable so a stale `enabled: false` from a previously
  // declined install of the same package can't survive a consented re-install.
  if (hasBoolFlag(argv, 'yes')) {
    await setPluginEnabled(packageName, true);
    process.stdout.write(colors.dim(`--yes: keeping ${packageName} enabled\n`));
    return 0;
  }
  const tty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  if (!tty) {
    await setPluginEnabled(packageName, false);
    process.stdout.write(
      `${packageName} is a third-party plugin and was left ${colors.bold('DISABLED')} ` +
        '(no TTY to ask for consent).\n' +
        'Re-run with --yes to accept its capability surface, or enable it later with ' +
        `\`moxxy plugins enable ${packageName}\`.\n`,
    );
    return 0;
  }
  const { confirm, isCancel } = await import('@clack/prompts');
  const keep = await confirm({
    message: `${packageName} is third-party code. Keep it enabled with this capability surface?`,
    initialValue: false,
  });
  if (isCancel(keep) || keep !== true) {
    await setPluginEnabled(packageName, false);
    process.stdout.write(
      `disabled ${packageName} — it stays installed but contributes nothing.\n` +
        colors.dim(`re-enable it anytime with \`moxxy plugins enable ${packageName}\`\n`),
    );
    return 0;
  }
  await setPluginEnabled(packageName, true);
  process.stdout.write(colors.dim(`${packageName} stays enabled\n`));
  return 0;
}

interface InstalledCapabilityProbe {
  readonly toolNames: ReadonlyArray<string>;
  readonly report?: InstallCapabilityReport;
}

/**
 * Boot a throwaway probe session (the freshly installed package loads with
 * everything else) and collect the package's tools + their combined
 * capability surface via plugin-host attribution. Null when the probe
 * itself fails — the review then proceeds with an unknown surface.
 */
async function probeInstalledCapabilities(
  argv: ParsedArgv,
  packageName: string,
): Promise<InstalledCapabilityProbe | null> {
  try {
    return await probeSession(
      argvToSetupOptions(argv, {
        skipKeyPrompt: true,
        tolerateNoProvider: true,
        skipProviderActivation: true,
      }),
      ({ session }) => {
        const toolNames = session.tools
          .list()
          .map((t) => t.name)
          .filter((name) => session.pluginHost.ownerOfTool?.(name) === packageName);
        const report = buildCapabilityReport(
          toolNames,
          (name) => session.tools.get(name)?.isolation,
        );
        return { toolNames, ...(report ? { report } : {}) };
      },
    );
  } catch {
    return null;
  }
}

function renderCapabilityReview(
  packageName: string,
  probe: InstalledCapabilityProbe | null,
): void {
  if (!probe) {
    process.stdout.write(
      colors.yellow(
        `couldn't inspect ${packageName}'s capability surface (probe failed) — ` +
          'review it with `moxxy security audit --package ' +
          packageName +
          '`\n',
      ),
    );
    return;
  }
  if (!probe.report) {
    process.stdout.write(
      colors.dim(
        `${packageName} registers no tools — no declared capability surface ` +
          '(providers/modes/channels it contributes still run unconfined)\n',
      ),
    );
    return;
  }
  const { report } = probe;
  process.stdout.write(
    '\n' +
      colors.bold('CAPABILITY SURFACE') +
      colors.dim(` — ${report.declared}/${report.total} tools declared`) +
      '\n',
  );
  const rows = describeCapabilitySurface(report.surface);
  if (rows.length === 0) {
    process.stdout.write(colors.dim('  (nothing declared beyond running in-process)\n'));
  }
  const labelCol = Math.max(9, ...rows.map((r) => r.label.length));
  for (const { label, value } of rows) {
    process.stdout.write(`  ${colors.bold(label.padEnd(labelCol))}  ${colors.dim(value)}\n`);
  }
  if (report.undeclaredTools?.length) {
    process.stdout.write(
      colors.yellow(`  ⚠ ${undeclaredToolsWarning(report.undeclaredTools.length, report.total)}\n`) +
        colors.yellow(`    undeclared: ${report.undeclaredTools.join(', ')}\n`),
    );
  }
  process.stdout.write('\n');
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
