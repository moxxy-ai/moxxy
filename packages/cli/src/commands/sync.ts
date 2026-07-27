import { installPluginPackagePinned, resolveInstallSource } from '@moxxy/plugin-plugins-admin';
import type { ParsedArgv } from '../argv.js';
import { argvToSetupOptions, hasBoolFlag, helpRequested } from '../argv-helpers.js';
import { probeSession } from '../setup.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { cliVersion } from '../version.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy sync',
  tagline: 'reconcile installed plugins with the config manifest',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['moxxy sync', 'install everything the manifest declares and is missing'],
        ['moxxy sync --check', 'report drift and exit 1 without changing anything'],
      ],
    },
    {
      title: 'NOTES',
      rows: [
        [
          'the manifest',
          'the merged `plugins.packages` map. Commit it with the project (or push it from the system scope) and every workstation converges on the same set.',
        ],
        [
          'not a remover',
          'sync installs what is missing and reports what is extra. Removing a package a user installed is their call, so it is reported, never done.',
        ],
      ],
    },
  ],
});

export interface Drift {
  /** Declared and enabled, but not loaded. The only hard failure. */
  readonly missing: ReadonlyArray<string>;
  /** Installed separately, absent from the manifest. */
  readonly extra: ReadonlyArray<string>;
  /** Present on disk but turned off in config; applies on the next boot. */
  readonly disabledButPresent: ReadonlyArray<string>;
}

export interface DriftInput {
  readonly loaded: ReadonlyArray<string>;
  /** Loaded packages the host flagged as discovered from ~/.moxxy/plugins. */
  readonly installedSeparately: ReadonlyArray<string>;
  readonly packages: Readonly<Record<string, { enabled?: boolean } | undefined>>;
}

/**
 * Compare the manifest against what is actually loaded.
 *
 * `extra` is computed from the host's static-vs-discovered flag rather than
 * from the package name: bundled kernel packages are always loaded and never
 * declared, so name-shape heuristics report a dozen false positives on a
 * healthy machine and train the operator to ignore the output.
 */
export function computeDrift(input: DriftInput): Drift {
  const loaded = new Set(input.loaded);
  const declared = Object.entries(input.packages);
  return {
    missing: declared
      .filter(([name, settings]) => settings?.enabled !== false && !loaded.has(name))
      .map(([name]) => name),
    disabledButPresent: declared
      .filter(([name, settings]) => settings?.enabled === false && loaded.has(name))
      .map(([name]) => name),
    extra: input.installedSeparately.filter((name) => !(name in input.packages)),
  };
}

export async function runSyncCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  const checkOnly = hasBoolFlag(argv, 'check');

  // A probe: registries only, no init hooks or daemons, and the session is
  // closed before we act. Booting a full session to decide what to install
  // would need the very plugins we are about to install.
  const probe = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    }),
    ({ session, config }) => ({
      loaded: session.pluginHost.list().map((p) => p.name),
      // `installed` is the host's own static-vs-discovered flag: true only for
      // packages that came from ~/.moxxy/plugins. Bundled kernel packages are
      // always loaded without ever being declared, so counting those as drift
      // would print a dozen lines on a healthy machine and train the operator
      // to ignore the output.
      installedSeparately: session.pluginHost
        .list()
        .filter((p) => p.installed)
        .map((p) => p.name),
      packages: config.plugins?.packages ?? {},
    }),
  );

  const declared = Object.entries(probe.packages);
  if (declared.length === 0) {
    process.stdout.write(
      colors.dim('no `plugins.packages` manifest found; nothing to reconcile\n'),
    );
    return 0;
  }

  const drift = computeDrift(probe);

  report(drift);

  if (checkOnly) {
    // Only MISSING is a hard failure. An extra package is a local decision, and
    // a disabled-but-present one applies on the next boot, so neither should
    // fail a pipeline that is checking "is this machine provisioned".
    return drift.missing.length > 0 ? 1 : 0;
  }
  if (drift.missing.length === 0) return 0;

  let failed = 0;
  for (const name of drift.missing) {
    try {
      const resolved = await resolveInstallSource(name);
      const result = await installPluginPackagePinned({
        packageName: resolved?.spec ?? name,
        ...(resolved?.pinnedVersion ? { pinnedVersion: resolved.pinnedVersion } : {}),
        ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
        onWarn: (msg) => process.stderr.write(colors.dim(msg) + '\n'),
      });
      process.stdout.write(`installed ${colors.bold(name)} ${colors.dim(`(${result.installed})`)}\n`);
    } catch (err) {
      failed++;
      printError(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed > 0) return 1;
  process.stdout.write(colors.dim('run `moxxy plugins reload` (or restart) to load them\n'));
  return 0;
}

function report(drift: Drift): void {
  if (drift.missing.length > 0) {
    process.stdout.write(colors.bold('missing') + colors.dim(' (declared, not installed)') + '\n');
    for (const n of drift.missing) process.stdout.write(`  ${n}\n`);
  }
  if (drift.disabledButPresent.length > 0) {
    process.stdout.write(
      colors.bold('\ndisabled') + colors.dim(' (installed but turned off in config)') + '\n',
    );
    for (const n of drift.disabledButPresent) process.stdout.write(`  ${n}\n`);
  }
  if (drift.extra.length > 0) {
    process.stdout.write(
      colors.bold('\nextra') + colors.dim(' (installed, not in the manifest)') + '\n',
    );
    for (const n of drift.extra) process.stdout.write(`  ${n}\n`);
  }
  if (drift.missing.length === 0 && drift.extra.length === 0 && drift.disabledButPresent.length === 0) {
    process.stdout.write(colors.dim('in sync with the manifest\n'));
  }
}
