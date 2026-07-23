import type { ChildProcess } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from '@moxxy/sdk';
import { moxxyHome } from '@moxxy/sdk/server';

import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';

export const LOCAL_PIPER_PACKAGE = '@moxxy/plugin-tts-local';
export const LOCAL_PIPER_SYNTHESIZER = 'local-piper';

const LOCAL_PIPER_ENTRY = './dist/index.js';
const MAX_MANIFEST_BYTES = 128 * 1024;

const localPiperManifestSchema = z.object({
  name: z.literal(LOCAL_PIPER_PACKAGE),
  moxxy: z.object({
    plugin: z.object({
      entry: z.literal(LOCAL_PIPER_ENTRY),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export type LocalPiperCliRunner = (args: ReadonlyArray<string>) => Promise<void>;

/**
 * Probe the optional package by its fixed first-party path and manifest. A
 * dependency entry alone is not enough: interrupted npm installs can leave a
 * package directory without the compiled discovery entry.
 */
export async function isLocalPiperInstalled(home = moxxyHome()): Promise<boolean> {
  const packageDirectory = path.join(
    home,
    'plugins',
    'node_modules',
    '@moxxy',
    'plugin-tts-local',
  );
  const manifestPath = path.join(packageDirectory, 'package.json');
  try {
    const metadata = await stat(manifestPath);
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return false;
    const parsed = localPiperManifestSchema.safeParse(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    );
    if (!parsed.success) return false;
    await access(path.join(packageDirectory, 'dist', 'index.js'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a single-flight installer. Every command is host-owned and uses argv
 * spawning (never a shell), so the renderer cannot choose an npm package,
 * contribution name or CLI flag.
 */
export function createLocalPiperInstaller(
  runCommand: LocalPiperCliRunner = runLocalPiperCliCommand,
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return (): Promise<void> => {
    if (inFlight) return inFlight;
    const started = installLocalPiper(runCommand);
    const tracked = started.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };
}

async function installLocalPiper(runCommand: LocalPiperCliRunner): Promise<void> {
  await runCommand(['plugins', 'install', LOCAL_PIPER_PACKAGE]);
  await runCommand(['plugins', 'enable', LOCAL_PIPER_PACKAGE]);
  await runCommand([
    'plugins',
    'set-default',
    'synthesizer',
    LOCAL_PIPER_SYNTHESIZER,
  ]);
}

async function runLocalPiperCliCommand(args: ReadonlyArray<string>): Promise<void> {
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('The bundled Moxxy CLI is unavailable.');
  const child = spawnCli(cli, args, { stdio: 'ignore' });
  const code = await waitForCommand(child);
  if (code === 0) return;
  throw new Error(
    'The offline voice package could not be installed. Check your internet connection and try again.',
  );
}

function waitForCommand(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    });
  });
}
