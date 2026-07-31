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
  for (const args of [
    ['plugins', 'install', LOCAL_PIPER_PACKAGE],
    ['plugins', 'enable', LOCAL_PIPER_PACKAGE],
    ['plugins', 'set-default', 'synthesizer', LOCAL_PIPER_SYNTHESIZER],
  ]) {
    try {
      await runCommand(args);
    } catch (error) {
      const message = toMessage(error);
      // Name the step even when the runner threw something we never shaped (a
      // spawn ENOENT, an injected test double): WHICH step failed is half the
      // diagnosis, and it is the half a screenshot can carry. Already-described
      // failures carry their own step, so don't stamp a second one on.
      throw message.includes('(while ')
        ? error
        : new Error(`${message} (while ${stepLabel(args)})`);
    }
  }
}

/** Bytes of CLI output retained for diagnosis — enough for npm's error block. */
const MAX_CAPTURED_OUTPUT = 8 * 1024;
/** Bytes of that output quoted back to the user when we can't classify it. */
const MAX_QUOTED_OUTPUT = 400;

/**
 * What the user was waiting for when a given step ran, as a gerund phrase.
 *
 * Lower-case and suffix-shaped on purpose: the renderer already prefixes
 * "Local Piper installation failed: ", so a message that opened with its own
 * "<Step> failed" read as "…failed: …failed:". The step rides at the end
 * instead, where it reads as the qualifier it is.
 */
function stepLabel(args: ReadonlyArray<string>): string {
  switch (args[1]) {
    case 'install':
      return 'downloading the voice package';
    case 'enable':
      return 'enabling the voice package';
    case 'set-default':
      return 'selecting the offline voice as the default';
    default:
      return 'setting up the offline voice';
  }
}

/**
 * Turn a failed CLI step into something the user can act on.
 *
 * This exists because the previous message was a hardcoded guess — every
 * non-zero exit was reported as "Check your internet connection", including the
 * common case of a host with no Node/npm at all, where the real output is
 * `error: spawn npm ENOENT` and no amount of checking the WiFi helps.
 *
 * Pure and exported so the mapping is testable against the CLI's REAL output
 * rather than through a spawned process. The order matters: npm-missing is
 * checked before the network patterns, because an ENOENT line can sit in the
 * same transcript as a retry notice that mentions the registry.
 */
export function describeLocalPiperFailure(
  args: ReadonlyArray<string>,
  output: string,
): string {
  const text = output.trim();
  const say = (reason: string): string => `${reason} (while ${stepLabel(args)})`;

  if (/spawn npm|npm.{0,3}: (not found|command not found)|'npm' is not recognized|ENOENT.*npm/i.test(text)) {
    return say(
      'Node.js and npm are required to install it, and npm was not found on this computer. ' +
        'Install Node.js (nodejs.org), then try again.',
    );
  }
  if (/EACCES|EPERM|EROFS|permission denied/i.test(text)) {
    return say(
      'the plugins folder could not be written (permission denied). ' +
        'Check permissions on ~/.moxxy/plugins, then try again.',
    );
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_SOCKET_TIMEOUT|network request to|offline/i.test(text)) {
    return say('the package registry could not be reached. Check your internet connection and try again.');
  }
  if (!text) {
    return say('the download reported no reason. Try again, and if it repeats please report it.');
  }
  // Unrecognised: quote the CLI's own words rather than inventing a cause. The
  // TAIL is the informative end — npm prints its error block last.
  return say(tail(text, MAX_QUOTED_OUTPUT));
}

async function runLocalPiperCliCommand(args: ReadonlyArray<string>): Promise<void> {
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('the bundled Moxxy CLI is unavailable.');
  // stderr is CAPTURED, not ignored: it carries the only description of what
  // actually went wrong, and discarding it is what made this failure
  // undiagnosable from a user's screenshot. stdout stays ignored — nothing
  // reads it, and a verbose npm run would buffer for no purpose.
  const child = spawnCli(cli, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let captured = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    captured += chunk.toString('utf8');
    if (captured.length > MAX_CAPTURED_OUTPUT) captured = captured.slice(-MAX_CAPTURED_OUTPUT);
  });
  const code = await waitForCommand(child);
  if (code === 0) return;
  throw new Error(describeLocalPiperFailure(args, captured));
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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(-max)}`;
}
