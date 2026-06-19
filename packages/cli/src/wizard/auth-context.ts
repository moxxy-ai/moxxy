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
  /**
   * Input stream for `promptMode: 'stdin'`. Defaults to `process.stdin`.
   * Injectable for tests (a script of lines) so a login round-trip can be
   * exercised without the real TTY.
   */
  readonly stdin?: NodeJS.ReadableStream;
}

export function buildProviderAuthContext(
  vault: VaultStore,
  opts: BuildAuthContextOptions,
): ProviderAuthContext {
  // 'stdin' mode always exposes a prompt (the host drives it over the pipe);
  // 'clack' only when there's a TTY. Headless with no prompt makes paste flows
  // fail fast with a "set the env var instead" message rather than hang.
  const prompt =
    opts.promptMode === 'stdin'
      ? makeStdinLinePrompt(opts.stdin ?? process.stdin)
      : opts.headless
        ? undefined
        : clackPrompt;
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
// One readline over the input stream, shared across the (sequential) prompt
// calls a single login makes. The host writes one line per prompt; we hand
// each line to the next waiting prompt, or queue it if it arrives early.
//
// The reader + queue + waiters are scoped PER `buildProviderAuthContext` call
// (a closure), not module globals: a second login in the same process must
// start fresh — stale queued lines or a permanently-true `stdinEnded` from a
// previous login would otherwise poison it (a closed-stdin trap that makes
// every future prompt return '' = cancellation).

/**
 * The readline interface currently attached to a given input stream. A second
 * login in the same process (e.g. the production GUI-host path that defaults to
 * `process.stdin`) would otherwise create a SECOND interface over the same
 * stream — both listening for `'line'`, interleaving/stealing each other's
 * input and leaking the first's listener for the process lifetime. We close the
 * prior interface before creating a new one for the same stream. Each
 * `buildProviderAuthContext` call still gets its own fresh queue/waiters/ended
 * state (the closure below), so this does not reintroduce cross-login poisoning.
 */
const activeReaders = new WeakMap<NodeJS.ReadableStream, Interface>();

function makeStdinLinePrompt(
  input: NodeJS.ReadableStream,
): (question: string, opts?: { readonly mask?: boolean }) => Promise<string> {
  let lineReader: Interface | null = null;
  let stdinEnded = false;
  const lineQueue: string[] = [];
  const lineWaiters: Array<(line: string) => void> = [];

  const ensureLineReader = (): void => {
    if (lineReader) return;
    // Tear down any reader a prior login left attached to this same stream so
    // two interfaces never compete for the same input lines.
    activeReaders.get(input)?.close();
    lineReader = createInterface({ input });
    activeReaders.set(input, lineReader);
    lineReader.on('line', (line) => {
      const waiter = lineWaiters.shift();
      if (waiter) waiter(line);
      else lineQueue.push(line);
    });
    // If the host closes stdin, don't leave a prompt hanging forever — resolve
    // pending + future reads as empty (treated as a cancellation by callers).
    lineReader.on('close', () => {
      stdinEnded = true;
      if (activeReaders.get(input) === lineReader) activeReaders.delete(input);
      for (const w of lineWaiters.splice(0)) w('');
    });
  };

  const readStdinLine = (): Promise<string> => {
    ensureLineReader();
    const queued = lineQueue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (stdinEnded) return Promise.resolve('');
    return new Promise<string>((resolve) => lineWaiters.push(resolve));
  };

  return async (question, promptOpts) => {
    // Emit a structured marker the host parses to render its own input field,
    // then await the answer as one stdin line. `mask` only hints the host's UI.
    process.stdout.write(encodeLoginPrompt({ question, mask: promptOpts?.mask === true }));
    return await readStdinLine();
  };
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
