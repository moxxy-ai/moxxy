/**
 * Figure out HOW `@moxxy/cli` was installed so `moxxy update` can run the right
 * upgrade command. Best-effort + heuristic: we infer the package manager and
 * whether it's a global install, then build the matching `<pm> <add> @moxxy/cli`
 * invocation. When we can't tell, we default to the overwhelmingly-common case
 * (`npm install -g`). A wrong guess is recoverable — the command prints what it
 * will run and the user can decline.
 *
 * Pure path/string analysis (no spawning) so it's trivially testable with
 * injected inputs.
 */

import { fileURLToPath } from 'node:url';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'workspace';

export interface InstallInfo {
  manager: PackageManager;
  /** True for a global install; false for project-local. Meaningless for 'workspace'. */
  global: boolean;
  /** The package to upgrade. */
  pkg: string;
  /** Command + args to upgrade to latest. Empty for 'workspace' (dev checkout). */
  cmd: string[];
  /** Resolved on-disk path of the running CLI, for diagnostics (or null). */
  installPath: string | null;
}

const PKG = '@moxxy/cli';

export interface DetectOpts {
  /** The module URL to resolve from (defaults to this file — i.e. the CLI itself). */
  fromUrl?: string;
  /** `npm_config_user_agent` value (defaults to the env var). */
  userAgent?: string;
  /** Current working dir (defaults to `process.cwd()`). */
  cwd?: string;
}

export function detectInstall(opts: DetectOpts = {}): InstallInfo {
  const fromUrl = opts.fromUrl ?? import.meta.url;
  const ua = opts.userAgent ?? process.env.npm_config_user_agent ?? '';
  let installPath: string | null = null;
  try {
    installPath = fileURLToPath(fromUrl);
  } catch {
    installPath = null;
  }
  const p = (installPath ?? '').replace(/\\/g, '/');

  // Running from the monorepo source (a dev checkout), not an installed package:
  // there's nothing to `npm install` — the user updates via git.
  if (p.includes('/packages/cli/')) {
    return { manager: 'workspace', global: false, pkg: PKG, cmd: [], installPath };
  }

  const manager = inferManager(p, ua);
  const global = looksGlobal(p, (opts.cwd ?? process.cwd()).replace(/\\/g, '/'));
  return { manager, global, pkg: PKG, cmd: upgradeCmd(manager, global), installPath };
}

/** Manager from the user-agent hint first (most reliable when present), then
 *  from telltale segments in the install path. */
function inferManager(p: string, ua: string): Exclude<PackageManager, 'workspace'> {
  const head = ua.split('/')[0]?.toLowerCase();
  if (head === 'pnpm' || head === 'yarn' || head === 'bun' || head === 'npm') return head;
  if (/(^|\/)\.?pnpm(\/|-global|$)|\/library\/pnpm\//i.test(p)) return 'pnpm';
  if (/\/\.bun\//i.test(p)) return 'bun';
  if (/\/\.?yarn\//i.test(p) || /\/\.config\/yarn\//i.test(p)) return 'yarn';
  return 'npm';
}

/** A CLI install that lives outside the current project tree is a global one.
 *  (Project-local CLI installs are rare; defaulting to global is the safe bet.) */
function looksGlobal(p: string, cwd: string): boolean {
  if (!p) return true;
  if (p.includes(`${cwd}/node_modules/`)) return false; // project-local dep
  return true;
}

function upgradeCmd(manager: Exclude<PackageManager, 'workspace'>, global: boolean): string[] {
  const target = `${PKG}@latest`;
  switch (manager) {
    case 'pnpm':
      return ['pnpm', 'add', ...(global ? ['-g'] : []), target];
    case 'yarn':
      return global ? ['yarn', 'global', 'add', target] : ['yarn', 'add', target];
    case 'bun':
      return ['bun', 'add', ...(global ? ['-g'] : []), target];
    case 'npm':
    default:
      return ['npm', 'install', ...(global ? ['-g'] : []), target];
  }
}

/** The command rendered as a copy-pasteable string. */
export function formatCmd(cmd: ReadonlyArray<string>): string {
  return cmd.join(' ');
}
