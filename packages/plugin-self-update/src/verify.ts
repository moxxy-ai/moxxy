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

function runCmd(cmd: string, args: ReadonlyArray<string>, cwd: string): Promise<RunCmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (d: Buffer): void => {
      output += d.toString('utf8');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), CMD_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, output: `${cmd} failed to start: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, output });
    });
  });
}

function truncate(s: string, n = 1200): string {
  return s.length <= n ? s : `…${s.slice(s.length - n)}`;
}

interface PkgJson {
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
}

async function readPkg(dir: string): Promise<PkgJson | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as PkgJson;
  } catch {
    return null;
  }
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

  // Install deps only if the plugin declares any and they aren't present yet.
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    const hasModules = await fs
      .access(path.join(target.path, 'node_modules'))
      .then(() => true)
      .catch(() => false);
    if (!hasModules) {
      const r = await runCmd('npm', ['install', '--no-fund', '--no-audit'], target.path);
      results.push({
        stage: 'install',
        ok: r.exitCode === 0,
        message: r.exitCode === 0 ? 'deps installed' : truncate(r.output),
      });
      if (r.exitCode !== 0) return results;
    }
  }

  if (pkg.scripts?.build) {
    const r = await runCmd('npm', ['run', 'build'], target.path);
    results.push({
      stage: 'build',
      ok: r.exitCode === 0,
      message: r.exitCode === 0 ? 'build ok' : truncate(r.output),
    });
    if (r.exitCode !== 0) return results;
  }

  if (pkg.scripts?.test) {
    const r = await runCmd('npm', ['test'], target.path);
    results.push({
      stage: 'test',
      ok: r.exitCode === 0,
      message: r.exitCode === 0 ? 'tests ok' : truncate(r.output),
    });
  }

  return results;
}

/** Minimal structural check that a skill file has the required frontmatter. */
export async function verifySkillFile(target: TxnTarget): Promise<StageResult> {
  let raw: string;
  try {
    raw = await fs.readFile(target.path, 'utf8');
  } catch {
    return { stage: 'parse', ok: false, message: `skill file not found: ${target.path}` };
  }
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    return { stage: 'parse', ok: false, message: 'missing YAML frontmatter block (--- … ---)' };
  }
  const body = fm[1] ?? '';
  const hasName = /^name:\s*\S+/m.test(body);
  const hasDesc = /^description:\s*\S+/m.test(body);
  if (!hasName || !hasDesc) {
    return {
      stage: 'parse',
      ok: false,
      message: 'frontmatter must declare both `name:` and `description:`',
    };
  }
  return { stage: 'parse', ok: true, message: 'frontmatter ok' };
}
