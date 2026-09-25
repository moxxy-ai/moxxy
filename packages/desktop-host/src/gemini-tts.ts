import type { ChildProcess } from 'node:child_process';
import { access, open } from 'node:fs/promises';
import path from 'node:path';

import { z } from '@moxxy/sdk';
import { moxxyHome } from '@moxxy/sdk/server';

import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';

export const GEMINI_TTS_PACKAGE = '@moxxy/plugin-tts-gemini';
const GEMINI_TTS_ENTRY = './dist/index.js';
const MAX_MANIFEST_BYTES = 128 * 1024;

const geminiTtsManifestSchema = z.object({
  name: z.literal(GEMINI_TTS_PACKAGE),
  moxxy: z.object({
    plugin: z.object({ entry: z.literal(GEMINI_TTS_ENTRY) }).passthrough(),
  }).passthrough(),
}).passthrough();

export type GeminiTtsCliRunner = (args: ReadonlyArray<string>) => Promise<void>;

/** Confirm that the fixed Gemini package has a valid discoverable entry. */
export async function isGeminiTtsInstalled(home = moxxyHome()): Promise<boolean> {
  const packageDirectory = path.join(
    home,
    'plugins',
    'node_modules',
    '@moxxy',
    'plugin-tts-gemini',
  );
  const manifestPath = path.join(packageDirectory, 'package.json');
  let handle: import('node:fs/promises').FileHandle | null = null;
  try {
    handle = await open(manifestPath, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return false;
    const parsed = geminiTtsManifestSchema.safeParse(
      JSON.parse(await handle.readFile({ encoding: 'utf8' })),
    );
    if (!parsed.success) return false;
    await access(path.join(packageDirectory, 'dist', 'index.js'));
    return true;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Installs the fixed first-party cloud voice package; callers never supply
 *  package names or CLI arguments from renderer input. */
export function createGeminiTtsInstaller(
  options: {
    readonly runCommand?: GeminiTtsCliRunner;
    readonly isInstalled?: () => Promise<boolean>;
  } = {},
): () => Promise<void> {
  const runCommand = options.runCommand ?? runGeminiTtsCliCommand;
  const isInstalled = options.isInstalled ?? (() => isGeminiTtsInstalled());
  let inFlight: Promise<void> | null = null;
  return (): Promise<void> => {
    if (inFlight) return inFlight;
    const started = installGeminiTts(runCommand, isInstalled);
    const tracked = started.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };
}

async function installGeminiTts(
  runCommand: GeminiTtsCliRunner,
  isInstalled: () => Promise<boolean>,
): Promise<void> {
  if (!(await isInstalled())) {
    await runCommand(['plugins', 'install', GEMINI_TTS_PACKAGE]);
  }
  await runCommand(['plugins', 'enable', GEMINI_TTS_PACKAGE]);
  await runCommand(['plugins', 'set-default', 'synthesizer', 'gemini-tts']);
}

async function runGeminiTtsCliCommand(args: ReadonlyArray<string>): Promise<void> {
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('The bundled Moxxy CLI is unavailable.');
  const child = spawnCli(cli, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const result = await waitForCommand(child);
  if (result.code === 0) return;
  const detail = result.stderr
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(' ')
    .slice(0, 1_200);
  throw new Error(
    detail
      ? `Gemini voice setup failed: ${detail}`
      : 'Gemini voice setup failed. Check your internet connection and try again.',
  );
}

function waitForCommand(
  child: ChildProcess,
): Promise<{ readonly code: number | null; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 4_096) stderr = stderr.slice(-4_096);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr });
    });
  });
}
