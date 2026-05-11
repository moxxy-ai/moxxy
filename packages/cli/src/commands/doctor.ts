import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ParsedArgv } from '../argv.js';
import { setupSessionWithConfig } from '../setup.js';
import { canonicalKey } from '../provider-keys.js';
import { colors } from '../colors.js';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  readonly id: string;
  readonly status: Status;
  readonly message: string;
}

const HELP = `moxxy doctor — diagnose your moxxy setup

  moxxy doctor                   run the full check sweep
  moxxy doctor --json            machine-readable output (one Check per line)
  moxxy doctor --check-keys      additionally call provider.validateKey() for
                                 each configured provider (uses real API calls)
`;

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

  const { session, config, configSources, vault, memory } = setupResult.value;

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
  const primary = config.provider?.name ?? 'anthropic';
  const fallbacks = config.provider?.fallbacks ?? [];
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
  const deps = { cwd: process.cwd(), vault, logger: session.logger, options: {} };
  const channelEntries = await session.channels.listWithAvailability(deps);
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

  // Plugins
  const pluginList = session.pluginHost.list();
  checks.push({
    id: 'plugins',
    status: 'ok',
    message: `${pluginList.length} loaded`,
  });

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
  const eCfg = config.embeddings?.provider ?? 'tfidf';
  checks.push({
    id: 'embeddings',
    status: 'ok',
    message: `provider=${eCfg}${config.embeddings?.model ? ` model=${config.embeddings.model}` : ''}`,
  });

  return emit(checks, asJson);
}

function emit(checks: ReadonlyArray<Check>, asJson: boolean): number {
  if (asJson) {
    for (const c of checks) process.stdout.write(JSON.stringify(c) + '\n');
  } else {
    let maxId = 0;
    for (const c of checks) maxId = Math.max(maxId, c.id.length);
    for (const c of checks) {
      const tag =
        c.status === 'ok'
          ? colors.green('[ ok ]')
          : c.status === 'warn'
            ? colors.yellow('[warn]')
            : colors.red('[fail]');
      const id = colors.bold(c.id.padEnd(maxId));
      const msg = c.status === 'ok' ? c.message : colors.dim(c.message);
      process.stdout.write(`${tag}  ${id}  ${msg}\n`);
    }
    const ok = checks.filter((c) => c.status === 'ok').length;
    const warn = checks.filter((c) => c.status === 'warn').length;
    const fail = checks.filter((c) => c.status === 'fail').length;
    process.stdout.write(
      '\n' +
        colors.bold('Summary: ') +
        colors.green(`${ok} ok`) +
        ', ' +
        colors.yellow(`${warn} warn`) +
        ', ' +
        (fail > 0 ? colors.red(`${fail} fail`) : `${fail} fail`) +
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
