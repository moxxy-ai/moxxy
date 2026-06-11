import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_EXPO_HOST = 'lan';
const DEFAULT_EXPO_PORT = 8081;
const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url));

export interface MobileExpoOptionsInput {
  readonly 'no-expo'?: unknown;
  readonly 'expo-host'?: unknown;
  readonly 'expo-port'?: unknown;
  readonly expoHost?: unknown;
  readonly expoPort?: unknown;
  readonly expoAppDir?: unknown;
}

export interface MobileExpoOptions {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly appDir?: string;
}

export interface MobileExpoHandle {
  stop(): Promise<void>;
}

export type SpawnProcess = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdio: 'inherit';
  },
) => ChildProcess;

export interface StartMobileExpoDeps {
  readonly spawnProcess?: SpawnProcess;
  readonly isPortOpen?: (host: string, port: number) => Promise<boolean>;
}

export function resolveMobileExpoOptions(options: MobileExpoOptionsInput = {}): MobileExpoOptions {
  const envDisabled = process.env.MOXXY_MOBILE_NO_EXPO === '1';
  const appDir = stringOption(options.expoAppDir) ?? process.env.MOXXY_MOBILE_APP_DIR;
  return {
    enabled: !envDisabled && !isTruthy(options['no-expo']),
    host: stringOption(options['expo-host']) ?? stringOption(options.expoHost) ?? DEFAULT_EXPO_HOST,
    port: parsePositiveInt(options['expo-port']) ?? parsePositiveInt(options.expoPort) ?? DEFAULT_EXPO_PORT,
    ...(appDir ? { appDir } : {}),
  };
}

export function buildExpoStartArgs(options: Pick<MobileExpoOptions, 'host' | 'port'>): string[] {
  return [
    'run',
    'start',
    '--',
    '--host',
    options.host,
    '--port',
    String(options.port),
  ];
}

export async function startMobileExpoApp(
  options: MobileExpoOptions,
  deps: StartMobileExpoDeps = {},
): Promise<MobileExpoHandle | null> {
  if (!options.enabled) return null;
  const appDir = options.appDir ?? resolveMobileExpoAppDir();
  if (!appDir) {
    console.log('Moxxy Mobile Expo app not found; skipping Expo startup.');
    return null;
  }
  if (await (deps.isPortOpen ?? isTcpPortOpen)('127.0.0.1', options.port)) {
    console.log(`Moxxy Mobile Expo already running on http://localhost:${options.port}`);
    return { stop: async () => undefined };
  }

  const spawnProcess = deps.spawnProcess ?? spawn;
  const child = spawnProcess('npm', buildExpoStartArgs(options), {
    cwd: appDir,
    env: {
      ...process.env,
      BROWSER: 'none',
      EXPO_NO_TELEMETRY: '1',
    },
    stdio: 'inherit',
  });

  const exited = new Promise<void>((resolveExit) => {
    child.once('exit', () => resolveExit());
    child.once('error', () => resolveExit());
  });

  return {
    stop: async () => {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
      await exited;
    },
  };
}

export function resolveMobileExpoAppDir(cwd = process.cwd()): string | null {
  const fromPackage = findMobilePocFrom(MODULE_DIR);
  if (fromPackage) return fromPackage;
  return findMobilePocFrom(cwd);
}

function findMobilePocFrom(start: string): string | null {
  let cursor = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(cursor, 'apps', 'mobile-poc');
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

async function isTcpPortOpen(host: string, port: number): Promise<boolean> {
  return await new Promise((resolveOpen) => {
    const socket = createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolveOpen(true);
    });
    socket.once('error', () => resolveOpen(false));
    socket.setTimeout(250, () => {
      socket.destroy();
      resolveOpen(false);
    });
  });
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
