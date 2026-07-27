import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Session } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import type { VaultStore } from '@moxxy/plugin-vault';
import type { MemoryStore } from '@moxxy/plugin-memory';
import { checkVoiceCaptureAvailable } from '@moxxy/plugin-cli';
import { corePreflight, detectCoreInstall } from '@moxxy/plugin-self-update';
import { hasProxy, redactProxyUrl } from '@moxxy/sdk/server';
import type { ParsedArgv } from '../argv.js';
import { setupSessionWithConfig } from '../setup.js';
import { closeSession } from '../setup/close-session.js';
import { embedderSelection } from '../setup/resolve-plugins-tree.js';
import { resolveEgressSettings } from '../setup/egress.js';
import type { RegistrationResult } from '../setup/register-plugins.js';
import { resolveProviderCredentials } from '../provider-credentials.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

type Status = 'ok' | 'warn' | 'fail';

export interface Check {
  readonly id: string;
  readonly status: Status;
  readonly message: string;
}


const HELP = formatHelp({
  title: 'moxxy doctor',
  tagline: 'diagnose your moxxy setup',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['moxxy doctor', 'run the full check sweep'],
        ['moxxy doctor --json', 'machine-readable output (one Check per line)'],
        ['moxxy doctor --check-keys', 'additionally call provider.validateKey() (real API calls)'],
      ],
    },
  ],
});

export async function runDoctorCommand(argv: ParsedArgv): Promise<number> {
  if (argv.flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const asJson = Boolean(argv.flags.json);
  const checkKeys = Boolean(argv.flags['check-keys']);
  const checks: Check[] = [];

  const setupResult = await tryCatch(() =>
    setupSessionWithConfig({
      cwd: process.cwd(),
      skipKeyPrompt: true,
      tolerateNoProvider: true,
    }),
  );

  if (!setupResult.ok) {
    checks.push({
      id: 'session',
      status: 'fail',
      message: `failed to boot session: ${setupResult.error}`,
    });
    return emit(checks, asJson);
  }

  const { session, config, configSources, vault, memory, pluginRegistration, persistence } =
    setupResult.value;

  try {
    return await runDoctorChecks({
      session,
      config,
      configSources,
      vault,
      memory,
      pluginRegistration,
      checks,
      checkKeys,
      asJson,
    });
  } finally {
    // Drain persistence + fire onShutdown hooks / stop the boot daemons so the
    // process exits promptly. Best-effort — never masks the doctor exit code.
    await closeSession(session, persistence);
  }
}

interface DoctorChecksDeps {
  readonly session: Session;
  readonly config: MoxxyConfig;
  readonly configSources: ReadonlyArray<{ scope: 'project' | 'user' | 'explicit'; path: string }>;
  readonly vault: VaultStore;
  /** Undefined on a slim boot without the memory plugin installed. */
  readonly memory: MemoryStore | undefined;
  readonly pluginRegistration: RegistrationResult;
  readonly checks: Check[];
  readonly checkKeys: boolean;
  readonly asJson: boolean;
}

async function runDoctorChecks(deps: DoctorChecksDeps): Promise<number> {
  const { session, config, configSources, vault, memory, pluginRegistration, checks, checkKeys, asJson } =
    deps;

  // Config
  if (configSources.length > 0) {
    const summary = configSources.map((s) => `${s.scope}:${s.path}`).join(', ');
    checks.push({ id: 'config', status: 'ok', message: `loaded from ${summary}` });
  } else {
    checks.push({
      id: 'config',
      status: 'warn',
      message: 'no moxxy.config.ts found; running with defaults',
    });
  }

  // Vault
  const vaultRes = await tryCatch(async () => {
    await vault.open();
    return vault.sourceName;
  });
  if (vaultRes.ok) {
    checks.push({ id: 'vault', status: 'ok', message: `unlocked via ${vaultRes.value}` });
  } else {
    checks.push({
      id: 'vault',
      status: 'fail',
      message: `cannot open vault: ${vaultRes.error}`,
    });
  }

  // Providers
  const primary = config.plugins?.provider?.default;
  const fallbacks = config.plugins?.provider?.fallbacks ?? [];
  const providerNames = Array.from(new Set([primary, ...fallbacks].filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  )));
  if (providerNames.length === 0) {
    checks.push({ id: 'providers', status: 'warn', message: 'no provider configured — run moxxy init' });
  }
  for (const name of providerNames) {
    const def = session.providers.list().find((p) => p.name === name);
    if (!def) {
      checks.push({
        id: `provider:${name}`,
        status: 'fail',
        message: `not registered (configured in provider.name or .fallbacks)`,
      });
      continue;
    }
    const resolved = await tryCatch(() => resolveProviderCredentials(def, vault, { cwd: session.cwd }, {
      interactive: false,
      providerConfig: config.plugins?.provider?.items?.[name]?.config ?? {},
    }));
    if (!resolved.ok) {
      checks.push({ id: `provider:${name}`, status: 'warn', message: resolved.error });
      continue;
    }
    if (checkKeys && def.validateKey && typeof resolved.value.apiKey === 'string') {
      const validation = await tryCatch(() => def.validateKey!(resolved.value.apiKey as string));
      let check: Check;
      if (!validation.ok) {
        check = { id: `provider:${name}`, status: 'fail', message: validation.error };
      } else if (!validation.value.ok) {
        check = { id: `provider:${name}`, status: 'fail', message: validation.value.message };
      } else {
        check = { id: `provider:${name}`, status: 'ok', message: 'credentials ready + validated' };
      }
      checks.push(check);
    } else {
      checks.push({ id: `provider:${name}`, status: 'ok', message: 'credentials ready' });
    }
  }

  // Channels
  const channelDeps = { cwd: process.cwd(), vault, logger: session.logger, options: {} };
  const channelEntries = await session.channels.listWithAvailability(channelDeps);
  for (const { def, availability } of channelEntries) {
    if (availability.ok) {
      checks.push({ id: `channel:${def.name}`, status: 'ok', message: 'available' });
    } else {
      checks.push({
        id: `channel:${def.name}`,
        status: 'warn',
        message: availability.reason ?? 'unavailable',
      });
    }
  }

  // Voice / STT
  checks.push(buildVoiceDoctorCheck(session, await checkVoiceCaptureAvailable()));

  // Plugins
  checks.push(...buildPluginDoctorChecks(pluginRegistration));

  // Memory (slim kernel: the plugin may not be installed — that's a state,
  // not a failure)
  if (!memory) {
    checks.push({
      id: 'memory',
      status: 'warn',
      message: 'memory plugin not installed — long-term memory off (moxxy plugins install @moxxy/plugin-memory)',
    });
  } else {
    const memDir = path.join(os.homedir(), '.moxxy', 'memory');
    const memRes = await tryCatch(async () => {
      await fs.mkdir(memDir, { recursive: true });
      await fs.access(memDir, fs.constants.W_OK);
      const entries = await memory.list();
      return { count: entries.length };
    });
    if (memRes.ok) {
      checks.push({
        id: 'memory',
        status: 'ok',
        message: `${memDir} writable (${memRes.value.count} entries)`,
      });
    } else {
      checks.push({
        id: 'memory',
        status: 'fail',
        message: `${memDir} not writable: ${memRes.error}`,
      });
    }
  }

  // Skills
  const allSkills = session.skills.list();
  checks.push({
    id: 'skills',
    status: 'ok',
    message: `${allSkills.length} skills discovered`,
  });

  // Embeddings
  const embedder = embedderSelection(config);
  const eProvider = embedder?.provider ?? 'tfidf';
  checks.push({
    id: 'embeddings',
    status: 'ok',
    message: `provider=${eProvider}${embedder?.model ? ` model=${embedder.model}` : ''}`,
  });

  // Network egress. The single most common "moxxy cannot reach the provider"
  // cause on a corporate host is a proxy that Node's global fetch ignores, so
  // say plainly whether one is in force and whether a custom CA was supplied.
  checks.push(buildEgressDoctorCheck(config));

  // Self-update — Tier-1 is always available if the plugin is loaded; Tier-2
  // (core patching) additionally needs git/pnpm + pinned source provenance.
  checks.push(await buildSelfUpdateDoctorCheck(session));

  return emit(checks, asJson);
}

/**
 * Report the effective outbound-network posture: which proxy (if any) global
 * `fetch` is routed through, and whether a custom CA bundle was supplied.
 *
 * `NODE_EXTRA_CA_CERTS` cannot be configured from inside the process (Node
 * reads it at startup), so this reports rather than fixes. A TLS-terminating
 * corporate proxy without it produces `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, which
 * is otherwise a very unrewarding error to diagnose.
 */
export function buildEgressDoctorCheck(config: MoxxyConfig): Check {
  const settings = resolveEgressSettings(config);
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  const caNote = ca ? `, extra CA=${ca}` : '';

  if (!hasProxy(settings)) {
    const forcedOff = config.network?.proxy === 'off';
    return {
      id: 'network',
      status: 'ok',
      message: `direct${forcedOff ? ' (network.proxy=off)' : ''}${caNote}`,
    };
  }
  const via = [
    settings.httpsProxy ? `https via ${redactProxyUrl(settings.httpsProxy)}` : null,
    settings.httpProxy ? `http via ${redactProxyUrl(settings.httpProxy)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const bypass = settings.noProxy ? `, bypass=${settings.noProxy}` : '';
  // A TLS-intercepting proxy without a trusted CA is the classic silent
  // failure, so nudge toward it rather than waiting for the handshake error.
  const status: Status = ca ? 'ok' : 'warn';
  const hint = ca ? '' : ' (set NODE_EXTRA_CA_CERTS if the proxy terminates TLS)';
  return { id: 'network', status, message: `${via}${bypass}${caNote}${hint}` };
}

export async function buildSelfUpdateDoctorCheck(session: Session): Promise<Check> {
  if (!session.tools.has('self_update_begin')) {
    return { id: 'self-update', status: 'warn', message: 'disabled (plugin not loaded)' };
  }
  const tier2 = session.tools.has('self_update_core_begin');
  if (!tier2) {
    return { id: 'self-update', status: 'ok', message: 'Tier 1 ready (plugins/skills); Tier 2 disabled' };
  }
  const pf = await corePreflight(detectCoreInstall(import.meta.url));
  if (pf.ok) return { id: 'self-update', status: 'ok', message: 'Tier 1 + Tier 2 (core) ready' };
  const failed = pf.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join('; ');
  return { id: 'self-update', status: 'warn', message: `Tier 1 ready; Tier 2 unavailable — ${failed}` };
}

export function buildVoiceDoctorCheck(
  session: Pick<Session, 'transcribers'>,
  captureReadiness: import('@moxxy/sdk').RequirementCheck,
): Check {
  if (!captureReadiness.ready) {
    const issue = captureReadiness.issues[0];
    return {
      id: 'voice',
      status: 'warn',
      message: issue?.hint ? issue.hint.replace(/`/g, '').replace(/\.$/, '') : issue?.message ?? 'audio capture unavailable',
    };
  }
  const active = session.transcribers.getActiveName();
  if (!active) {
    const registered = session.transcribers.list().map((def) => def.name);
    return {
      id: 'voice',
      status: 'warn',
      message: registered.length > 0
        ? `audio capture available; no active transcriber (installed: ${registered.join(', ')})`
        : 'audio capture available; no transcriber installed',
    };
  }
  return { id: 'voice', status: 'ok', message: `ready — transcriber=${active}` };
}

export function buildPluginDoctorChecks(summary: RegistrationResult): Check[] {
  const loaded = summary.registered.size;
  const skipped = summary.skipped.length;
  const checks: Check[] = [
    {
      id: 'plugins',
      status: skipped > 0 ? 'warn' : 'ok',
      message: `${loaded} loaded, ${skipped} skipped`,
    },
  ];

  for (const record of summary.skipped) {
    const hint = record.hints[0];
    checks.push({
      id: `plugin:${record.pluginName}`,
      status: 'warn',
      message: `skipped — ${record.message}${hint ? ` (${hint})` : ''}`,
    });
  }
  return checks;
}

function emit(checks: ReadonlyArray<Check>, asJson: boolean): number {
  if (asJson) {
    for (const c of checks) process.stdout.write(JSON.stringify(c) + '\n');
  } else {
    let maxId = 0;
    for (const c of checks) maxId = Math.max(maxId, c.id.length);
    process.stdout.write(colors.bold('CHECKS') + '\n');
    for (const c of checks) {
      // Tag aligned at a fixed width. Mono baseline; semantic color
      // only on warn/fail so the eye is pulled to actionable rows.
      const tag =
        c.status === 'ok'
          ? colors.dim(' ok ')
          : c.status === 'warn'
            ? colors.yellow('warn')
            : colors.red('fail');
      const id = colors.bold(c.id.padEnd(maxId));
      const msg = c.status === 'ok' ? colors.dim(c.message) : c.message;
      process.stdout.write(`  ${tag}  ${id}  ${msg}\n`);
    }
    const ok = checks.filter((c) => c.status === 'ok').length;
    const warn = checks.filter((c) => c.status === 'warn').length;
    const fail = checks.filter((c) => c.status === 'fail').length;
    process.stdout.write(
      '\n' +
        colors.bold('SUMMARY') + '\n' +
        '  ' +
        colors.dim(`${ok} ok`) +
        '  ' +
        (warn > 0 ? colors.yellow(`${warn} warn`) : colors.dim(`${warn} warn`)) +
        '  ' +
        (fail > 0 ? colors.red(`${fail} fail`) : colors.dim(`${fail} fail`)) +
        '\n',
    );
  }
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}

interface OkResult<T> {
  readonly ok: true;
  readonly value: T;
}
interface ErrResult {
  readonly ok: false;
  readonly error: string;
}
async function tryCatch<T>(fn: () => Promise<T>): Promise<OkResult<T> | ErrResult> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
