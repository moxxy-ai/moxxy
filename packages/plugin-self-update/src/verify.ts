import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TxnTarget } from './transaction.js';

/**
 * Build/test verification for a transaction target, run as child processes so a
 * failing build can never crash the host. Pure I/O — no moxxy core imports.
 */

export interface StageResult {
  readonly stage: string;
  readonly ok: boolean;
  readonly message: string;
}

export interface RunCmdResult {
  readonly exitCode: number;
  readonly output: string;
}

const CMD_TIMEOUT_MS = 5 * 60_000;
/**
 * Cap on retained child output. A model-triggered `npm run build/test` can emit
 * unbounded output; holding it all in the live process risks OOM. Callers only
 * read the trailing ~1.2KB, so a sliding tail is lossless for them.
 */
const MAX_CMD_OUTPUT_BYTES = 512 * 1024;

function runCmd(cmd: string, args: ReadonlyArray<string>, cwd: string): Promise<RunCmdResult> {
  return new Promise((resolve) => {
    // `detached` lets a timeout SIGKILL the whole process group (npm fans out to
    // node/esbuild/vitest workers that an immediate-child kill would orphan).
    const child = spawn(cmd, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let buf = '';
    const onData = (d: Buffer): void => {
      buf += d.toString('utf8');
      if (buf.length > MAX_CMD_OUTPUT_BYTES) buf = buf.slice(buf.length - MAX_CMD_OUTPUT_BYTES);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => killTree(child), CMD_TIMEOUT_MS);
    let settled = false;
    const finish = (r: RunCmdResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      resolve(r);
    };
    child.on('error', (err) => finish({ exitCode: -1, output: `${cmd} failed to start: ${err.message}` }));
    child.on('close', (code) => finish({ exitCode: code ?? -1, output: buf }));
  });
}

/** SIGKILL a detached child's whole process group, tolerating an already-dead group. */
function killTree(child: { pid?: number; kill: (s: NodeJS.Signals) => boolean }): void {
  try {
    if (child.pid != null) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function truncate(s: string, n = 1200): string {
  return s.length <= n ? s : `…${s.slice(s.length - n)}`;
}

interface PkgJson {
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  /** npm-standard `packageManager` field, e.g. "pnpm@9.0.0" — selects the verifier toolchain. */
  readonly packageManager?: string;
}

async function readPkg(dir: string): Promise<PkgJson | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as PkgJson;
  } catch {
    return null;
  }
}

/** Per-package-manager invocations for the install / run-script / test steps. */
interface PmCommands {
  readonly install: ReadonlyArray<string>;
  readonly run: (script: string) => ReadonlyArray<string>;
  readonly test: ReadonlyArray<string>;
  readonly bin: string;
}

const PM_COMMANDS: Record<string, PmCommands> = {
  npm: { bin: 'npm', install: ['install', '--no-fund', '--no-audit'], run: (s) => ['run', s], test: ['test'] },
  pnpm: { bin: 'pnpm', install: ['install'], run: (s) => ['run', s], test: ['test'] },
  yarn: { bin: 'yarn', install: ['install'], run: (s) => ['run', s], test: ['test'] },
  bun: { bin: 'bun', install: ['install'], run: (s) => ['run', s], test: ['test'] },
};

/**
 * Pick the package manager from the npm-standard `packageManager` field
 * ("pnpm@9", "yarn@4", …) so a non-npm plugin can declare its toolchain. The
 * default is npm, preserving prior behavior for plugins that omit the field or
 * name an unknown manager.
 */
function pmFor(pkg: PkgJson): PmCommands {
  const name = (pkg.packageManager ?? '').split('@')[0]?.trim().toLowerCase();
  return (name && PM_COMMANDS[name]) || PM_COMMANDS.npm!;
}

/**
 * Run a plugin's own `build` and `test` npm scripts when present. A plugin
 * scaffolded as a zero-build `.mjs` (no scripts) passes straight through —
 * jiti / dynamic-import handles it at reload time, which is the real load test.
 */
export async function verifyPluginBuild(target: TxnTarget): Promise<ReadonlyArray<StageResult>> {
  const results: StageResult[] = [];
  const pkg = await readPkg(target.path);
  if (!pkg) return results; // no package.json (e.g. bare .mjs) → nothing to build

  const pm = pmFor(pkg);

  // Install deps only if the plugin declares any and they aren't present yet.
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    const hasModules = await fs
      .access(path.join(target.path, 'node_modules'))
      .then(() => true)
      .catch(() => false);
    if (!hasModules) {
      const r = await runCmd(pm.bin, pm.install, target.path);
      results.push({
        stage: 'install',
        ok: r.exitCode === 0,
        message: r.exitCode === 0 ? 'deps installed' : truncate(r.output),
      });
      if (r.exitCode !== 0) return results;
    }
  }

  if (pkg.scripts?.build) {
    const r = await runCmd(pm.bin, pm.run('build'), target.path);
    results.push({
      stage: 'build',
      ok: r.exitCode === 0,
      message: r.exitCode === 0 ? 'build ok' : truncate(r.output),
    });
    if (r.exitCode !== 0) return results;
  }

  if (pkg.scripts?.test) {
    const r = await runCmd(pm.bin, pm.test, target.path);
    results.push({
      stage: 'test',
      ok: r.exitCode === 0,
      message: r.exitCode === 0 ? 'tests ok' : truncate(r.output),
    });
  }

  return results;
}

/**
 * Require a real (non-empty, non-blank-quoted) value after a frontmatter key.
 * Rejects `name:`, `name: ""`, `name: '   '` — a quote alone satisfied the old
 * `\S+`, accepting a structurally-present-but-empty field.
 */
const FRONTMATTER_FIELD = (key: string): RegExp =>
  new RegExp(`^${key}:[ \\t]*(?:"[ \\t]*[^"\\s][^"]*"|'[ \\t]*[^'\\s][^']*'|[^"'\\s].*)$`, 'm');

/** Minimal structural check that a skill file has the required frontmatter. */
export async function verifySkillFile(target: TxnTarget): Promise<StageResult> {
  let raw: string;
  try {
    raw = await fs.readFile(target.path, 'utf8');
  } catch {
    return { stage: 'parse', ok: false, message: `skill file not found: ${target.path}` };
  }
  // Normalize CRLF so a Windows-authored skill isn't rejected by the \n anchors.
  const normalized = raw.replace(/\r\n/g, '\n');
  const fm = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    return { stage: 'parse', ok: false, message: 'missing YAML frontmatter block (--- … ---)' };
  }
  const body = fm[1] ?? '';
  const hasName = FRONTMATTER_FIELD('name').test(body);
  const hasDesc = FRONTMATTER_FIELD('description').test(body);
  if (!hasName || !hasDesc) {
    return {
      stage: 'parse',
      ok: false,
      message: 'frontmatter must declare both a non-empty `name:` and `description:`',
    };
  }
  return { stage: 'parse', ok: true, message: 'frontmatter ok' };
}
