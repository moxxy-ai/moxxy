import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ExecFileSyncOptions,
  type SpawnOptions,
} from 'node:child_process';
import { statSync } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const WINDOWS_NATIVE_EXTENSIONS = new Set(['.com', '.exe']);
const WINDOWS_SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1']);
const KNOWN_NODE_CLIS = new Set<KnownNodeCli>(['moxxy', 'npm', 'pnpm', 'yarn']);

type KnownNodeCli = 'moxxy' | 'npm' | 'pnpm' | 'yarn';

export type ExecutableTarget =
  | { readonly kind: 'direct'; readonly command: string }
  | {
      readonly kind: 'node';
      readonly command: string;
      readonly entry: string;
      readonly env: Readonly<Record<string, string>>;
    };

export interface ExecutableSearchOptions {
  readonly extraPaths?: ReadonlyArray<string>;
  readonly platform?: NodeJS.Platform;
  readonly pathEnv?: string;
  readonly pathext?: string;
  readonly nodeCommand?: string;
  /** Trusted JS entrypoint for a known launcher whose package is not adjacent to its shim. */
  readonly nodeEntryHint?: string;
  readonly electron?: boolean;
}

/** Spawn options that cannot opt back into a command shell. */
export type SafeSpawnOptions = Omit<SpawnOptions, 'shell'> & { readonly shell?: never };
export type SafeExecFileSyncOptions = Omit<ExecFileSyncOptions, 'shell'> & {
  readonly shell?: never;
};

/**
 * Filenames Windows itself considers for a bare command name, in PATHEXT order.
 *
 * The extensionless npm shim is deliberately absent: npm writes a POSIX script
 * beside its Windows launchers, but CreateProcess cannot safely execute it.
 * Off Windows the bare name remains the executable.
 */
export function executableCandidates(
  name: string,
  platform: NodeJS.Platform = process.platform,
  pathext: string | undefined = process.env.PATHEXT,
): string[] {
  if (platform !== 'win32' || path.extname(name)) return [name];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (pathext ?? DEFAULT_WINDOWS_PATHEXT).split(';')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const extension = (trimmed.startsWith('.') ? trimmed : `.${trimmed}`).toLowerCase();
    if (seen.has(extension)) continue;
    seen.add(extension);
    out.push(`${name}${extension}`);
  }
  return out;
}

/** Find the first readable file using PATH-directory order, then PATHEXT order. */
export function findExecutable(
  name: string,
  extraPaths: ReadonlyArray<string> = [],
  opts: ExecutableSearchOptions = {},
): string | null {
  const platform = opts.platform ?? process.platform;
  if (hasPathSeparator(name, platform)) return isFile(name) ? name : null;

  const separator = platform === 'win32' ? ';' : path.delimiter;
  const dirs = (opts.pathEnv ?? process.env.PATH ?? '')
    .split(separator)
    .concat(extraPaths)
    .filter(Boolean);
  const candidates = executableCandidates(name, platform, opts.pathext);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (isFile(full)) return full;
    }
  }
  return null;
}

/**
 * Resolve a command without ever delegating argument parsing to a shell.
 *
 * Native executables and POSIX commands run directly. On Windows, supported
 * Node launchers are mapped to their known JS entrypoints and run through the
 * current Node/Electron runtime. Any other Windows script shim fails closed:
 * parsing an arbitrary .cmd/.bat/.ps1 would recreate the shell-injection
 * boundary this helper exists to remove.
 */
export function resolveExecutableTarget(
  name: string,
  opts: ExecutableSearchOptions = {},
): ExecutableTarget | null {
  const platform = opts.platform ?? process.platform;
  const executable = findExecutable(name, opts.extraPaths ?? [], opts);
  if (!executable) return null;
  if (platform !== 'win32') return { kind: 'direct', command: executable };

  const rawExtension = path.extname(executable);
  const extension = rawExtension.toLowerCase();
  if (WINDOWS_NATIVE_EXTENSIONS.has(extension)) {
    return { kind: 'direct', command: executable };
  }
  if (!WINDOWS_SCRIPT_EXTENSIONS.has(extension)) {
    throw new Error(
      `Refusing to execute extensionless Windows command "${executable}". ` +
        'Install a native executable or a supported Node .cmd launcher.',
    );
  }
  if (extension !== '.cmd') {
    throw unknownWindowsShim(executable);
  }

  const commandName = path.basename(executable, rawExtension).toLowerCase();
  if (!isKnownNodeCli(commandName)) {
    throw unknownWindowsShim(executable);
  }
  const entries = opts.nodeEntryHint
    ? [opts.nodeEntryHint, ...knownNodeCliEntries(executable, commandName)]
    : knownNodeCliEntries(executable, commandName);
  const entry = entries.find(isFile);
  if (!entry) {
    throw new Error(
      `Cannot resolve ${commandName} JavaScript entry beside Windows shim "${executable}". ` +
        'Refusing to run the .cmd file through a shell.',
    );
  }

  const electron = opts.electron ?? Boolean(process.versions.electron);
  return {
    kind: 'node',
    command: opts.nodeCommand ?? process.execPath,
    entry,
    env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
}

/** Spawn a resolved target with an argv array and an explicitly shell-free API. */
export function spawnExecutableTarget(
  target: ExecutableTarget,
  args: ReadonlyArray<string>,
  opts: SafeSpawnOptions = {},
): ChildProcess {
  const argv = target.kind === 'node' ? [target.entry, ...args] : [...args];
  const targetEnv = target.kind === 'node' ? target.env : {};
  return spawn(target.command, argv, {
    ...opts,
    env: { ...process.env, ...opts.env, ...targetEnv },
    shell: false,
  });
}

/** Synchronous counterpart for build scripts that must finish one command at a time. */
export function execExecutableTargetSync(
  target: ExecutableTarget,
  args: ReadonlyArray<string>,
  opts: SafeExecFileSyncOptions = {},
): void {
  const argv = target.kind === 'node' ? [target.entry, ...args] : [...args];
  const targetEnv = target.kind === 'node' ? target.env : {};
  execFileSync(target.command, argv, {
    ...opts,
    env: { ...process.env, ...opts.env, ...targetEnv },
    shell: false,
  });
}

function knownNodeCliEntries(shim: string, command: KnownNodeCli): string[] {
  const binDir = path.dirname(shim);
  if (command === 'npm') {
    return [
      path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(binDir, '..', 'npm', 'bin', 'npm-cli.js'),
    ];
  }
  if (command === 'moxxy') {
    return [
      path.join(binDir, 'node_modules', '@moxxy', 'cli', 'dist', 'bin.js'),
      path.join(binDir, '..', '@moxxy', 'cli', 'dist', 'bin.js'),
    ];
  }
  if (command === 'pnpm') {
    return [
      path.join(binDir, 'node_modules', 'corepack', 'dist', 'pnpm.js'),
      path.join(binDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
      path.join(binDir, '..', 'corepack', 'dist', 'pnpm.js'),
      path.join(binDir, '..', 'pnpm', 'bin', 'pnpm.cjs'),
    ];
  }
  return [
    path.join(binDir, 'node_modules', 'corepack', 'dist', 'yarn.js'),
    path.join(binDir, 'node_modules', 'yarn', 'bin', 'yarn.js'),
    path.join(binDir, 'node_modules', '@yarnpkg', 'cli-dist', 'bin', 'yarn.js'),
    path.join(binDir, '..', 'corepack', 'dist', 'yarn.js'),
    path.join(binDir, '..', 'yarn', 'bin', 'yarn.js'),
    path.join(binDir, '..', '@yarnpkg', 'cli-dist', 'bin', 'yarn.js'),
  ];
}

function isKnownNodeCli(command: string): command is KnownNodeCli {
  return KNOWN_NODE_CLIS.has(command as KnownNodeCli);
}

function hasPathSeparator(name: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32'
    ? name.includes('\\') || name.includes('/')
    : name.includes(path.sep);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function unknownWindowsShim(executable: string): Error {
  return new Error(
    `Refusing to execute unknown Windows command shim "${executable}". ` +
      'Only moxxy.cmd, npm.cmd, pnpm.cmd, and yarn.cmd are mapped to known JavaScript entrypoints; ' +
      'shell execution is disabled.',
  );
}
