import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Session } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import type { VaultStore } from '@moxxy/plugin-vault';
import type { MemoryStore } from '@moxxy/plugin-memory';
import { checkVoiceCaptureAvailable } from '@moxxy/plugin-cli';
import { corePreflight, detectCoreInstall } from '@moxxy/plugin-self-update';
import type { RequirementIssue } from '@moxxy/sdk';
import type { RequirementCheck } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { setupSessionWithConfig } from '../setup.js';
import { closeSession } from '../setup/close-session.js';
import { embedderSelection } from '../setup/resolve-plugins-tree.js';
import type { RegistrationResult } from '../setup/register-plugins.js';
import { canonicalKey } from '../provider-keys.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

type Status = 'ok' | 'warn' | 'fail';

export interface Check {
  readonly id: string;
  readonly status: Status;
  readonly message: string;
}

const CODEX_TRANSCRIBER_NAME = 'openai-codex-transcribe';
const CODEX_PROVIDER_NAME = 'openai-codex';
const CODEX_AUTH_RUNTIME = 'auth:provider:openai-codex';

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
  readonly memory: MemoryStore;
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
  const primary = config.plugins?.provider?.default ?? 'anthropic';
  const fallbacks = config.plugins?.provider?.fallbacks ?? [];
  const providerNames = Array.from(new Set([primary, ...fallbacks]));
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
    const canonical = canonicalKey(name);
    let key: string | null = null;
    try {
      key = await vault.get(canonical);
    } catch {
      // vault unavailable already reported
    }
    if (!key) key = process.env[canonical] ?? null;
    if (!key) {
      checks.push({
        id: `provider:${name}`,
        status: 'warn',
        message: `no key in vault or ${canonical} env — interactive prompt would fire`,
      });
      continue;
    }
    if (checkKeys && def.validateKey) {
      const v = await tryCatch(() => def.validateKey!(key!));
      if (!v.ok) {
        checks.push({
          id: `provider:${name}`,
          status: 'fail',
          message: `validateKey threw: ${v.error}`,
        });
      } else if (!v.value.ok) {
        checks.push({
          id: `provider:${name}`,
          status: 'fail',
          message: v.value.message,
        });
      } else {
        checks.push({ id: `provider:${name}`, status: 'ok', message: 'key resolved + validated' });
      }
    } else {
      checks.push({ id: `provider:${name}`, status: 'ok', message: 'key resolved' });
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

  // Memory
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

  // Self-update — Tier-1 is always available if the plugin is loaded; Tier-2
  // (core patching) additionally needs git/pnpm + pinned source provenance.
  checks.push(await buildSelfUpdateDoctorCheck(session));

  return emit(checks, asJson);
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
  session: Session,
  captureReadiness: RequirementCheck = { ready: true, issues: [] },
): Check {
  const readiness = combineRequirementChecks(
    session.requirements.check([
      { kind: 'transcriber', name: CODEX_TRANSCRIBER_NAME },
      { kind: 'provider', name: 'openai-codex', state: 'active' },
      { kind: 'runtime', name: 'auth:provider:openai-codex', state: 'ready' },
    ]),
    captureReadiness,
  );
  const activeProvider = session.providers.getActiveName() ?? '(none)';
  const activeTranscriber = session.transcribers.getActiveName();
  const hasCodexTranscriber = session.transcribers.has(CODEX_TRANSCRIBER_NAME);

  if (!readiness.ready) {
    return {
      id: 'voice',
      status: 'warn',
      message: `unavailable — ${formatVoiceRequirementIssue(readiness.issues[0])}`,
    };
  }

  if (activeTranscriber && activeTranscriber !== CODEX_TRANSCRIBER_NAME) {
    return {
      id: 'voice',
      status: 'warn',
      message: `unavailable — active transcriber is ${activeTranscriber}; expected ${CODEX_TRANSCRIBER_NAME}`,
    };
  }

  return {
    id: 'voice',
    status: hasCodexTranscriber && activeProvider === CODEX_PROVIDER_NAME ? 'ok' : 'warn',
    message:
      hasCodexTranscriber && activeProvider === CODEX_PROVIDER_NAME
        ? `ready — provider=${activeProvider} transcriber=${CODEX_TRANSCRIBER_NAME}`
        : `unavailable — ${CODEX_TRANSCRIBER_NAME} is not registered`,
  };
}

function combineRequirementChecks(a: RequirementCheck, b: RequirementCheck): RequirementCheck {
  return { ready: a.ready && b.ready, issues: [...a.issues, ...b.issues] };
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

function formatVoiceRequirementIssue(issue: RequirementIssue | undefined): string {
  if (!issue) return 'unknown voice requirement is not ready';
  if (issue.requirement.kind === 'provider' && issue.requirement.name === CODEX_PROVIDER_NAME) {
    if (issue.code === 'missing') return `${CODEX_PROVIDER_NAME} is not registered`;
    return `${CODEX_PROVIDER_NAME} is not active`;
  }
  if (issue.requirement.kind === 'runtime' && issue.requirement.name === CODEX_AUTH_RUNTIME) {
    return 'run moxxy login openai-codex';
  }
  if (issue.requirement.kind === 'runtime' && issue.requirement.name === 'voice:capture:ffmpeg') {
    return 'ffmpeg is required for voice input';
  }
  if (issue.requirement.kind === 'transcriber' && issue.requirement.name === CODEX_TRANSCRIBER_NAME) {
    return `${CODEX_TRANSCRIBER_NAME} is not registered`;
  }
  return issue.hint ? stripBackticks(issue.hint).replace(/\.$/, '') : issue.message;
}

function stripBackticks(value: string): string {
  return value.replace(/`/g, '');
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
