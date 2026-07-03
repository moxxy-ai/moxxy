import { cancel, confirm, isCancel, intro, log, note, outro, select, spinner } from '@clack/prompts';
import { loadActiveProvider, setPluginEnabled } from '@moxxy/config';
import {
  INSTALLABLE_PLUGIN_CATALOG,
  installPluginPackagePinned,
  type PluginCatalogEntry,
} from '@moxxy/plugin-plugins-admin';
import { EXIT_AFTER_PAIR_FLAG } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { hasBoolFlag, helpRequested, stringFlag } from '../argv-helpers.js';
import { colors } from '../colors.js';
import { probeSession } from '../setup.js';
import { cliVersion } from '../version.js';
import { runPluginSetupSteps } from '../wizard/plugin-setup-steps.js';
import { formatHelp } from './help-format.js';
import { runInitCommand } from './init.js';
import { runChannelSubcommand } from './run-channel.js';
import { serveSpec } from './serve.js';
import {
  getServiceStatus,
  installAndStartService,
  servicePlatform,
} from './service/index.js';

/**
 * `moxxy onboard` — the one guided path from a fresh install to a paired,
 * always-on agent:
 *
 *   1. provider  — `moxxy init`'s wizard, skipped when one is configured
 *   2. channel   — pick a messenger from the install catalog
 *   3. install   — catalog install (version-pinned) + `moxxy.setup` fields
 *   4. pair      — the channel's own pair flow, in pair-then-return mode
 *   5. service   — a `moxxy serve --all` launchd/systemd unit (opt-out)
 *
 * Every step delegates to the machinery that owns it (init wizard, plugin
 * setup steps, channel subcommands, service installer) — onboard only
 * sequences them, so each step keeps behaving identically when run standalone.
 */

/**
 * Messengers offered by the pick, in presentation order. Metadata (label,
 * package) comes from the install catalog's `provides` declarations; this
 * list only curates WHICH channel-category entries read as "message your
 * agent from your phone" (web/http are transports, not messengers) and the
 * one-line trade-off shown next to each.
 */
const ONBOARD_CHANNELS: ReadonlyArray<{ readonly name: string; readonly hint: string }> = [
  { name: 'discord', hint: 'official API · DM code pairing' },
  { name: 'telegram', hint: 'official API · QR pairing' },
  { name: 'whatsapp', hint: 'UNOFFICIAL (Baileys) — ToS/ban risk, use a spare number' },
  { name: 'signal', hint: 'QR device link · needs signal-cli on PATH' },
  { name: 'slack', hint: 'workspace bot · needs a public Request URL' },
];

export interface OnboardChannelChoice {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
  readonly entry: PluginCatalogEntry;
  readonly installed: boolean;
}

/** The catalog entry that `provides` the named channel, if any. */
export function catalogChannelEntry(name: string): PluginCatalogEntry | undefined {
  return INSTALLABLE_PLUGIN_CATALOG.find((e) =>
    e.provides?.some((p) => p.category === 'channel' && p.name === name),
  );
}

/**
 * Build the channel pick list: the curated messengers, each resolved against
 * the catalog (drops silently if its entry disappears) and marked installed
 * when the channel is already registered in the session.
 */
export function buildChannelChoices(installed: ReadonlySet<string>): OnboardChannelChoice[] {
  const choices: OnboardChannelChoice[] = [];
  for (const { name, hint } of ONBOARD_CHANNELS) {
    const entry = catalogChannelEntry(name);
    if (!entry) continue;
    const isInstalled = installed.has(name);
    choices.push({
      value: name,
      label: entry.label,
      hint: isInstalled ? `installed · ${hint}` : hint,
      entry,
      installed: isInstalled,
    });
  }
  return choices;
}

const HELP = formatHelp({
  title: 'moxxy onboard',
  tagline: 'guided setup: provider → messaging channel → pairing → background service',
  sections: [
    {
      title: 'FLAGS',
      rows: [
        ['--channel <name>', 'skip the pick: onboard this channel (discord|telegram|whatsapp|signal|slack)'],
        ['--no-service', 'skip the background-service step'],
        ['--reinit', 'run the provider wizard even when a provider is already configured'],
      ],
    },
    {
      title: 'NOTES',
      rows: [
        ['Interactive', 'onboard needs a TTY. For scripted setup use `moxxy provision`; for env-key bootstrap use headless `moxxy init`.'],
        ['Service', 'installs a `moxxy serve --all` launchd/systemd unit — every channel + scheduler + webhooks in one background process.'],
        ['Re-run', 'onboard is idempotent: configured steps are skipped or re-offered with their current values.'],
      ],
    },
  ],
});

export async function runOnboardCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  if (process.stdin.isTTY !== true) {
    process.stderr.write(
      colors.red('moxxy onboard is interactive and needs a TTY.') +
        '\n' +
        colors.dim(
          '  Scripted setup: `moxxy provision` (flags or --spec -). Env-key bootstrap: headless `moxxy init`.\n',
        ),
    );
    return 1;
  }

  // ── Step 1: provider ────────────────────────────────────────────────────
  // `moxxy init` owns this flow (vault passphrase, wizard, plugin setup
  // steps). Skip it when a default provider is already configured.
  const provider = await loadActiveProvider();
  if (!provider || hasBoolFlag(argv, 'reinit')) {
    const code = await runInitCommand(argv);
    if (code !== 0) return code;
  }

  intro(colors.bold('moxxy onboard'));
  const activeProvider = provider ?? (await loadActiveProvider());
  if (provider) {
    log.info(`Provider already configured: ${colors.bold(provider)} ${colors.dim('(--reinit to change)')}`);
  }

  // ── Step 2: pick a channel ──────────────────────────────────────────────
  const installedChannels = await probeSession(
    {
      cwd: process.cwd(),
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    },
    ({ session }) => new Set(session.channels.list().map((d) => d.name)),
  );
  const choices = buildChannelChoices(installedChannels);

  const preset = stringFlag(argv, 'channel')?.toLowerCase();
  let picked: OnboardChannelChoice | null = null;
  if (preset) {
    picked = choices.find((c) => c.value === preset) ?? null;
    if (!picked) {
      process.stderr.write(
        colors.red(`--channel ${preset} is not an onboardable channel.`) +
          '\n' +
          colors.dim(`  known: ${choices.map((c) => c.value).join(', ')}\n`),
      );
      return 2;
    }
  } else {
    const answer = await select<string>({
      message: 'Where do you want to message your agent?',
      options: [
        ...choices.map((c) => ({ value: c.value, label: c.label, hint: c.hint })),
        { value: '', label: 'Skip — terminal only', hint: '`moxxy` starts the TUI' },
      ],
    });
    if (isCancel(answer)) {
      cancel('Onboarding cancelled — run `moxxy onboard` anytime.');
      return 0;
    }
    picked = choices.find((c) => c.value === answer) ?? null;
  }

  if (!picked) {
    // Terminal-only: nothing to install or keep alive; the TUI self-hosts.
    outro(
      `You're set. ${colors.bold('moxxy')} starts the TUI` +
        (activeProvider ? colors.dim(` (provider: ${activeProvider})`) : '') +
        '.',
    );
    return 0;
  }

  // ── Step 3: install + declared setup fields ─────────────────────────────
  if (!picked.installed) {
    const s = spinner();
    s.start(`Installing ${picked.entry.packageName}…`);
    try {
      await installPluginPackagePinned({
        packageName: picked.entry.packageName,
        ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
      });
      await setPluginEnabled(picked.entry.packageName, true);
      s.stop(`Installed ${picked.entry.packageName} ✓`);
    } catch (err) {
      s.stop('Install failed.');
      log.error(err instanceof Error ? err.message : String(err));
      process.stderr.write(
        colors.dim(`  Retry with: moxxy plugins install ${picked.entry.id}\n`),
      );
      return 1;
    }
  }

  // ── Step 4: setup fields + pair (one probe session, post-install so
  // discovery sees the new package — same daemon-less probe the standalone
  // `moxxy <channel> pair` path runs on) ──────────────────────────────────
  type PairOutcome = 'paired' | 'skipped' | 'no-pair' | 'failed' | 'missing';
  const channelName = picked.value;
  const packageName = picked.entry.packageName;
  const pairOutcome = await probeSession(
    {
      cwd: process.cwd(),
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    },
    async ({ session, vault, config }): Promise<PairOutcome> => {
      const def = session.channels.get(channelName);
      if (!def) {
        log.error(
          `channel "${channelName}" did not register after install — check \`moxxy plugins list\`.`,
        );
        return 'missing';
      }

      // The plugin's declared `moxxy.setup` fields (tokens → vault). Re-runs
      // prefill, so an already-configured channel just confirms through.
      try {
        await runPluginSetupSteps({ vault, cwd: process.cwd(), only: [packageName] });
      } catch (err) {
        log.warn(
          `setup fields failed (continuing — \`moxxy ${channelName}\` re-runs them): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      if (!def.subcommands?.['pair']) return 'no-pair';
      const wantPair = await confirm({
        message: `Pair ${def.name} now?`,
        initialValue: true,
      });
      if (isCancel(wantPair) || !wantPair) return 'skipped';

      const code = await runChannelSubcommand(def, 'pair', {
        session,
        vault,
        config,
        argv: {
          command: channelName,
          positional: [],
          // Pair-then-return: the channel restarts under the service below.
          flags: { [EXIT_AFTER_PAIR_FLAG]: true },
        },
      });
      return code === 0 ? 'paired' : 'failed';
    },
  );
  if (pairOutcome === 'missing') return 1;
  if (pairOutcome === 'failed') {
    log.warn(
      `Pairing didn't complete. Finish it later with ${colors.bold(`moxxy ${channelName}`)} — the rest of onboarding continues.`,
    );
  }

  // ── Step 5: background service ──────────────────────────────────────────
  const spec = serveSpec(new Set(), true);
  let serviceState: 'installed' | 'skipped' | 'unsupported' | 'failed' = 'skipped';
  if (!hasBoolFlag(argv, 'no-service')) {
    if (servicePlatform() === 'unsupported') {
      serviceState = 'unsupported';
      note(
        `Background services aren't wired up on ${process.platform} yet.\n` +
          `Keep the agent reachable with a foreground ${colors.bold('moxxy serve --all')}.`,
        'always on',
      );
    } else {
      const status = await getServiceStatus(spec);
      const wantService = await confirm({
        message: status.installed
          ? 'Restart the background service so it picks up the new channel?'
          : 'Run moxxy as a background service? (always on — survives logout and reboot)',
        initialValue: true,
      });
      if (!isCancel(wantService) && wantService) {
        const result = await installAndStartService(spec);
        if (result.ok) {
          serviceState = 'installed';
          log.success(`Service installed ✓ ${colors.dim(`(log: ${result.logPath})`)}`);
        } else {
          serviceState = 'failed';
          log.error(`Service install failed: ${result.message}`);
          process.stderr.write(colors.dim('  Run it in the foreground instead: moxxy serve --all\n'));
        }
      }
    }
  }

  // ── Outro: what you have now ────────────────────────────────────────────
  const lines: string[] = [];
  if (activeProvider) lines.push(`Provider  ${colors.bold(activeProvider)}`);
  lines.push(
    `Channel   ${colors.bold(channelName)}  ${
      pairOutcome === 'paired'
        ? 'paired ✓'
        : pairOutcome === 'no-pair'
          ? colors.dim('(no pairing step)')
          : colors.dim(`(pair later: moxxy ${channelName})`)
    }`,
  );
  lines.push(
    `Service   ${
      serviceState === 'installed'
        ? `running ✓  ${colors.dim('moxxy service status|logs|stop serve')}`
        : serviceState === 'unsupported'
          ? colors.dim('unsupported platform — moxxy serve --all')
          : serviceState === 'failed'
            ? colors.dim('failed — moxxy serve --all runs it in the foreground')
            : colors.dim('skipped — moxxy service install serve when ready')
    }`,
  );
  note(lines.join('\n'), 'your agent');

  outro(
    pairOutcome === 'paired' && serviceState === 'installed'
      ? `Message your agent now — it answers on ${colors.bold(channelName)}. The terminal works too: ${colors.bold('moxxy')}.`
      : `Almost there — finish the steps above, then message your agent on ${colors.bold(channelName)}.`,
  );
  return 0;
}
