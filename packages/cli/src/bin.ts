#!/usr/bin/env node
import { moxxyHome } from '@moxxy/sdk/server';
import { detectCoreInstall, finalizeStagedCoreUpdate } from '@moxxy/plugin-self-update';
import { parseArgv, type ParsedArgv } from './argv.js';
import { runPromptCommand } from './commands/prompt.js';
import { runTuiCommand } from './commands/tui.js';
import { runSkillsCommand } from './commands/skills.js';
import { runPluginsCommand } from './commands/plugins.js';
import { runChannelsCommand } from './commands/channels.js';
import { runChannelByName } from './commands/run-channel.js';
import { runInitCommand } from './commands/init.js';
import { runOnboardCommand } from './commands/onboard.js';
import { runProvisionCommand } from './commands/provision.js';
import { runPermsCommand } from './commands/perms.js';
import { runConfigCommand } from './commands/config.js';
import { runMemoryCommand } from './commands/memory.js';
import { runMcpCommand } from './commands/mcp.js';
import { runScheduleCommand } from './commands/schedule.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runLoginCommand } from './commands/login.js';
import { runResumeCommand } from './commands/resume.js';
import { runServiceCommand } from './commands/service.js';
import { runServeCommand } from './commands/serve.js';
import { runAgentCommand } from './commands/agent.js';
import { runCollabCommand } from './commands/collab.js';
import { runSessionsCommand } from './commands/sessions.js';
import { runSecurityCommand } from './commands/security.js';
import { runSelfUpdateCommand } from './commands/self-update.js';
import { runUpdateCommand } from './commands/update.js';
import { probeSession } from './setup.js';
import { renderLogo } from './logo.js';
import { colors } from './colors.js';
import { cliVersion } from './version.js';
import { pickSlogan } from '@moxxy/plugin-cli';
import { formatErrorForCli } from './error-formatter.js';
import { installProcessGuards } from './process-guards.js';

type CommandHandler = (argv: ParsedArgv) => Promise<number>;

/**
 * Help is rendered as section blocks: dim bold header, then two
 * columns per row (bold command + dim description). Matches the
 * `moxxy channels` listing aesthetic — no rails, no clack glyphs,
 * mono palette only.
 */
const SECTIONS: ReadonlyArray<{ readonly title: string; readonly rows: ReadonlyArray<readonly [string, string]> }> = [
  {
    title: 'USAGE',
    rows: [
      ['moxxy', 'start the interactive TUI (default channel)'],
      ['moxxy <channel>', 'start a registered channel by name (see `moxxy channels`)'],
      ['moxxy -p "…"', 'one-shot prompt to stdout'],
      ['moxxy <command> …', 'run a built-in subcommand (see below)'],
    ],
  },
  {
    title: 'SETUP',
    rows: [
      ['onboard', 'guided setup: provider → messaging channel → pairing → background service'],
      ['init', 'interactive first-time setup (provider keys → vault)'],
      ['provision', 'headless setup: install + configure a provider (flags or --spec -)'],
      ['login <provider>', 'OAuth sign-in for providers that don\'t use API keys'],
      ['login status|logout', 'inspect / remove stored OAuth credentials'],
      ['doctor [--check-keys]', 'diagnose config, vault, providers, channels, memory'],
      ['update [--check|--yes]', 'upgrade the moxxy CLI to the latest published version'],
    ],
  },
  {
    title: 'RUN',
    rows: [
      ['tui', 'start the Ink TUI channel'],
      ['resume [-s <id>|<id>]', 'resume a persisted session (interactive picker if no id)'],
      ['channels', 'list registered channels + their subcommands'],
      ['channels start|stop <name>', 'run a channel detached on its own runner (or stop it)'],
      ['channels status [name]', 'list the detached channels currently running'],
      ['channels <name>', 'start a channel by name in the foreground (same as `moxxy <name>`)'],
      ['channels <name> <sub>', 'invoke a channel-defined subcommand'],
      ['serve [--except <list>]', 'run every channel + background daemon in ONE process'],
    ],
  },
  {
    title: 'MANAGE',
    rows: [
      ['sessions list|delete', 'list / remove persisted sessions'],
      ['skills list|new|audit', 'manage skill files'],
      ['plugins list|search|install|remove|enable|disable|reload|new', 'find, install + manage plugins'],
      ['self-update status|rollback', 'inspect / roll back self-update transactions'],
      ['perms list|allow|deny|remove|clear|path', 'view / edit the permission policy'],
      ['config show|get|set|path', 'read / edit the moxxy config (user or project scope)'],
      ['memory list|audit|show|revert|prune-stale|path', 'curate long-term memory'],
      ['security audit|isolators|status', 'inspect plugin-security isolation state'],
      ['mcp list|enable|disable|remove|path', 'manage Model Context Protocol servers'],
      ['schedule list|add|remove|run|daemon', 'manage time-driven prompts (cron / heartbeat)'],
      ['service list|install|uninstall|start|stop|logs', 'run channels + scheduler as a background OS unit'],
    ],
  },
  {
    title: 'FLAGS',
    rows: [
      ['--prompt, -p "…"', 'one-shot input (alias of the positional `prompt` form)'],
      ['--model <id>', 'override the default model for this invocation'],
      ['--output-format <fmt>', 'text | json | stream-json (one-shot output mode)'],
      ['--allow-tools, --allow-all', 'permission shortcuts for non-interactive runs'],
      ['--help, --version', 'this help / print version'],
    ],
  },
  {
    title: 'ENV',
    rows: [
      ['ANTHROPIC_API_KEY', 'default Anthropic provider key'],
      ['OPENAI_API_KEY', 'OpenAI provider key (and openai embeddings)'],
      ['MOXXY_HOME', 'override the ~/.moxxy data directory'],
      ['MOXXY_DEBUG=1', 'verbose error output + process diagnostics'],
      ['MOXXY_FIXTURES', 'record | replay — provider fixture mode (used by tests)'],
      ['MOXXY_VAULT_PASSPHRASE', 'headless vault passphrase (alt to keychain)'],
      ['MOXXY_TELEGRAM_TOKEN', 'override the vault-stored Telegram token'],
      ['MOXXY_HTTP_TOKEN', 'bearer token for the HTTP channel'],
      ['MOXXY_MOBILE_TOKEN | _HOST | _TUNNEL', 'mobile channel auth / bind host / tunnel'],
      ['MOXXY_SESSION_ID', 'sticky session id for `moxxy serve` (resume-if-present)'],
      ['MOXXY_RUNNER_SOCKET', "override the runner's unix-socket path"],
      ['(full list)', 'see the Environment variables table in the README'],
    ],
  },
];

// Indent of the command column under each rule; the rule label sits two
// spaces shallower so the divider's `──` brackets the group title.
const ROW_INDENT = 4;
const RULE_INDENT = 2;

function renderHelp(): string {
  const width = process.stdout.columns ?? 80;

  // Center the slogan + version "crown" to the terminal, matching the
  // bootscreen. Pad off the VISIBLE length (raw strings) — the ANSI codes
  // colors.* add are zero-width and would otherwise skew the math.
  const version = cliVersion();
  const slogan = pickSlogan();
  const tail = version ? `  ·  v${version}` : '';
  const headerVisible = slogan.length + tail.length;
  const headerPad = ' '.repeat(Math.max(0, Math.floor((width - headerVisible) / 2)));
  const header =
    headerPad + colors.dim(colors.italic(slogan)) + (tail ? colors.dim(tail) : '');

  // Width of the widest rendered "    cmd  desc" row across every section —
  // the dividers extend to this so they all line up, capped to the terminal.
  const rowWidth = Math.max(
    ...SECTIONS.map((s) => {
      const colWidth = Math.max(...s.rows.map(([cmd]) => cmd.length));
      return Math.max(...s.rows.map(([, desc]) => ROW_INDENT + colWidth + 2 + desc.length));
    }),
  );
  const ruleWidth = Math.min(rowWidth, width - RULE_INDENT);

  // A dim-gray hairline rule introducing a group: `  ── label ─────…`.
  const rule = (label: string): string => {
    const lead = `── ${label} `;
    const fill = '─'.repeat(Math.max(0, ruleWidth - RULE_INDENT - lead.length));
    return ' '.repeat(RULE_INDENT) + colors.dim(colors.gray(lead + fill));
  };

  const out: string[] = [];
  out.push(header);
  out.push('');

  SECTIONS.forEach((section, i) => {
    // Per-section column width so short commands (moxxy, init, tui) sit
    // tight against their descriptions instead of floating off a global max.
    const colWidth = Math.max(...section.rows.map(([cmd]) => cmd.length));
    out.push(rule(section.title.toLowerCase()));
    for (const [cmd, desc] of section.rows) {
      const padded = cmd.padEnd(colWidth, ' ');
      out.push(`${' '.repeat(ROW_INDENT)}${colors.bold(padded)}  ${colors.dim(desc)}`);
    }
    if (i < SECTIONS.length - 1) out.push('');
  });

  out.push('');
  out.push(
    `${' '.repeat(RULE_INDENT)}${colors.dim('Keys resolve vault → env var → interactive prompt (TTY only;')}`,
  );
  out.push(
    `${' '.repeat(RULE_INDENT)}${colors.dim('prompted values are saved back to the vault).')}`,
  );
  out.push('');
  out.push(`${colors.dim('Run')} ${colors.bold('moxxy onboard')} ${colors.dim('to get started.')}`);
  out.push(`${colors.dim('See')} ${colors.bold('moxxy <command> --help')} ${colors.dim('for per-command details.')}`);

  return out.join('\n') + '\n';
}

// Single source of truth: a command name → handler dispatch table. Adding a
// new built-in subcommand here is enough; there's no separate KNOWN_COMMANDS
// set that can drift out of sync.
const COMMANDS: Record<string, CommandHandler> = {
  help: async () => {
    process.stdout.write(renderLogo(undefined, { center: true }) + renderHelp());
    return 0;
  },
  version: async () => {
    const v = cliVersion() ?? '0.0.0';
    const width = process.stdout.columns ?? 80;
    const line = `moxxy ${v}`;
    const pad = ' '.repeat(Math.max(0, Math.floor((width - line.length) / 2)));
    process.stdout.write(
      renderLogo(undefined, { center: true }) + pad + line + '\n',
    );
    return 0;
  },
  init: runInitCommand,
  onboard: runOnboardCommand,
  provision: runProvisionCommand,
  login: runLoginCommand,
  perms: runPermsCommand,
  config: runConfigCommand,
  memory: runMemoryCommand,
  mcp: runMcpCommand,
  schedule: runScheduleCommand,
  doctor: runDoctorCommand,
  update: runUpdateCommand,
  prompt: runPromptCommand,
  tui: runTuiCommand,
  resume: runResumeCommand,
  service: runServiceCommand,
  serve: runServeCommand,
  // Internal: a collaboration peer runner spawned by `collaborative` mode.
  agent: runAgentCommand,
  // The dedicated collaboration coordinator runner (spawned by the collaborate UI).
  collab: runCollabCommand,
  sessions: runSessionsCommand,
  security: runSecurityCommand,
  skills: runSkillsCommand,
  plugins: runPluginsCommand,
  channels: runChannelsCommand,
  'self-update': runSelfUpdateCommand,
};

async function main(): Promise<number> {
  const argv = parseArgv(process.argv.slice(2));

  // Reaching this point means the (possibly overlaid) core code imported
  // cleanly, so commit any staged Tier-2 core patch. Best-effort — never
  // block boot on it. A persistently-failing finalize would otherwise strand a
  // staged update with zero signal; surface it under MOXXY_DEBUG so it's at
  // least observable, while still never blocking boot.
  //
  // Resolve the LIVE @moxxy/core install (from this module's location) and pass
  // it through so finalize's boot-time safety nets actually run in production:
  // reconcile an overlay interrupted mid-swap, and refuse to commit an overlay
  // that never recorded a complete apply. detectCoreInstall returns null in
  // layouts it can't resolve (e.g. a dev checkout far from node_modules), in
  // which case finalize stays best-effort exactly as before.
  await finalizeStagedCoreUpdate(moxxyHome(), detectCoreInstall(import.meta.url)).catch((err: unknown) => {
    if (isDebugEnabled()) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`finalizeStagedCoreUpdate failed: ${msg}\n`);
    }
  });

  const handler = COMMANDS[argv.command];
  if (handler) return handler(argv);

  // Not a built-in. See if it names a registered channel — skip the
  // API-key prompt so a typo doesn't accidentally boot the provider.
  //
  // CRITICAL: the try/catch wraps ONLY the channel-existence probe. A
  // failure in `runChannelByName` (e.g. a channel's interactive setup
  // hand-off recursing into itself, the bot throwing on startup) must
  // bubble out as a real error — silently swallowing it and falling
  // through to "unknown command" misled users into thinking the
  // channel disappeared mid-flow.
  let isChannel = false;
  try {
    // Throwaway probe (no init hooks/daemons, no persistence, closed
    // before returning): we only need the channel registry here, never
    // the provider. Activating it can hang or throw on hosts without a
    // configured key, which would mask the real "unknown command"
    // feedback.
    isChannel = await probeSession(
      {
        cwd: process.cwd(),
        skipKeyPrompt: true,
        tolerateNoProvider: true,
        skipProviderActivation: true,
      },
      ({ session }) => session.channels.has(argv.command),
    );
  } catch {
    // Probe failed; fall through to "unknown command" so the user
    // gets a clear message rather than a confusing setup stack trace.
  }
  if (isChannel) {
    // Outside the try: any error from running the channel propagates
    // normally and is surfaced by the top-level .catch in main().then().
    return await runChannelByName(argv.command, argv);
  }

  // Slim kernel: the name may be a KNOWN channel whose package just isn't
  // installed (telegram/slack/web/http install on demand). Point at the
  // install instead of a bare "unknown command".
  const { findCatalogEntryForChannel } = await import('./channel-hints.js');
  const hint = findCatalogEntryForChannel(argv.command);
  if (hint) {
    process.stderr.write(
      colors.red(`channel not installed: ${argv.command}`) +
        `\ninstall it with: ${colors.bold(`moxxy plugins install ${hint.id}`)}` +
        `\n(or from the TUI: /plugins → Installable → ${hint.label})\n`,
    );
    return 2;
  }

  process.stderr.write(
    colors.red(`unknown command: ${argv.command}`) + '\n' + renderHelp(),
  );
  return 2;
}

// Self-identify in `ps` output: peer-recovery code (web surface port
// freeing, runner protocol-mismatch recovery) only ever signals processes
// whose command line carries a moxxy marker, and a dev-checkout daemon's
// argv (`node …/packages/cli/dist/bin.js serve`) wouldn't otherwise match.
process.title = ['moxxy', ...process.argv.slice(2)].join(' ');

// Last-resort guards (log + survive unhandledRejection, log + exit 1 on
// uncaughtException) — installed before any command runs so the long-lived
// entries (serve / tui / channel daemons) are always covered.
installProcessGuards();

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(formatErrorForCli(err, { debug: isDebugEnabled() }) + '\n');
    process.exit(1);
  },
);

function isDebugEnabled(): boolean {
  const v = process.env.MOXXY_DEBUG;
  return v === '1' || v === 'true';
}
