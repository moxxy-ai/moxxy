/**
 * Helpers that bridge the CLI's runtime (vault store, stdout) to the
 * provider-agnostic `ProviderAuthContext` declared in `@moxxy/sdk`. Every
 * `moxxy login` and `moxxy init` call funnels through here so the OAuth
 * dance is identical regardless of which provider plugin owns it.
 */

import { createInterface, type Interface } from 'node:readline';
import { MoxxyError, encodeLoginPrompt, type ProviderAuthContext, type ProviderDef } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { isCancel, password, text } from '@clack/prompts';

export interface BuildAuthContextOptions {
  readonly headless: boolean;
  /** Defaults to writing through `process.stdout`. Wizard hosts pass a clack-aware writer. */
  readonly write?: (chunk: string) => void;
  /**
   * How `ctx.prompt` is satisfied. `'clack'` (default) renders interactive TTY
   * prompts. `'stdin'` relays each prompt to the host as a NUL-bracketed marker
   * on stdout and reads the answer back as one stdin line — for a GUI host (the
   * desktop app) that drives `moxxy login` as a subprocess with no TTY and so
   * can't render a clack prompt. The out-of-band paste flows (claude-code)
   * work identically; only the input transport differs.
   */
  readonly promptMode?: 'clack' | 'stdin';
}

export function buildProviderAuthContext(
  vault: VaultStore,
  opts: BuildAuthContextOptions,
): ProviderAuthContext {
  // 'stdin' mode always exposes a prompt (the host drives it over the pipe);
  // 'clack' only when there's a TTY. Headless with no prompt makes paste flows
  // fail fast with a "set the env var instead" message rather than hang.
  const prompt =
    opts.promptMode === 'stdin' ? stdinLinePrompt : opts.headless ? undefined : clackPrompt;
  return {
    headless: opts.headless,
    write: opts.write ?? ((s) => process.stdout.write(s)),
    ...(prompt ? { prompt } : {}),
    vault: {
      get: (key) => vault.get(key),
      set: (key, value, tags) => vault.set(key, value, tags ? [...tags] : undefined),
      delete: (key) => vault.delete(key),
    },
  };
}

// --- stdin-driven prompt (GUI host over a subprocess) ----------------------
//
// One readline over the process's stdin, shared across the (sequential) prompt
// calls a single login makes. The host writes one line per prompt; we hand
// each line to the next waiting prompt, or queue it if it arrives early.

let lineReader: Interface | null = null;
let stdinEnded = false;
const lineQueue: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];

function ensureLineReader(): void {
  if (lineReader) return;
  lineReader = createInterface({ input: process.stdin });
  lineReader.on('line', (line) => {
    const waiter = lineWaiters.shift();
    if (waiter) waiter(line);
    else lineQueue.push(line);
  });
  // If the host closes stdin, don't leave a prompt hanging forever — resolve
  // pending + future reads as empty (treated as a cancellation by callers).
  lineReader.on('close', () => {
    stdinEnded = true;
    for (const w of lineWaiters.splice(0)) w('');
  });
}

function readStdinLine(): Promise<string> {
  ensureLineReader();
  const queued = lineQueue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  if (stdinEnded) return Promise.resolve('');
  return new Promise<string>((resolve) => lineWaiters.push(resolve));
}

async function stdinLinePrompt(
  question: string,
  opts?: { readonly mask?: boolean },
): Promise<string> {
  // Emit a structured marker the host parses to render its own input field,
  // then await the answer as one stdin line. `mask` only hints the host's UI.
  process.stdout.write(encodeLoginPrompt({ question, mask: opts?.mask === true }));
  return await readStdinLine();
}

async function clackPrompt(question: string, opts?: { readonly mask?: boolean }): Promise<string> {
  const answer = opts?.mask
    ? await password({ message: question })
    : await text({ message: question });
  if (isCancel(answer)) {
    throw new MoxxyError({ code: 'AUTH_DENIED', message: 'Sign-in cancelled.' });
  }
  return typeof answer === 'string' ? answer : '';
}

/** True if the provider plugin advertises an OAuth login flow. */
export function isOAuthProvider(def: ProviderDef): boolean {
  return def.auth?.kind === 'oauth';
}
