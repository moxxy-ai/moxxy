/**
 * Interactive provider sign-in, driven from the desktop UI.
 *
 * The desktop has no TTY, so it spawns `moxxy login <provider> --stdin-prompts`
 * and relays the flow: the CLI streams the provider's progress text on stdout
 * and emits each interactive prompt (the out-of-band token / authorization-code
 * paste that `claude-code` needs) as a NUL-bracketed marker, which the shared
 * {@link createLoginStreamScanner} pulls out. We forward output + prompts to the
 * renderer as `provider.login.*` events and write the user's typed answers back
 * as stdin lines. Loopback providers (openai-codex) emit no prompts — the CLI
 * opens the browser, catches the callback, and exits; the renderer just shows
 * the streamed log.
 *
 * Encryption + the OAuth dance stay entirely in the CLI (mirroring
 * `saveProviderKey` → `moxxy vault set`); this module is only a relay.
 */

import type { BrowserWindow } from 'electron';
import { createLoginStreamScanner } from '@moxxy/sdk';
import type { ChildProcess } from 'node:child_process';
import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';
import { assertSafeProviderName } from './security';
import { sendEvent } from './send-event';

interface LoginRun {
  readonly child: ChildProcess;
  readonly window: BrowserWindow;
}

/** In-flight logins, keyed by the renderer-supplied correlation id. One per
 *  sign-in modal; the map lets a second window run its own without crosstalk. */
const runs = new Map<string, LoginRun>();

/**
 * Spawn an interactive login for `provider`, streaming `provider.login.output`
 * + `provider.login.prompt` events tagged with `loginId`, and a final
 * `provider.login.done` with the exit code. The renderer answers prompts via
 * {@link answerProviderLogin}. Throws if the CLI can't be resolved or a login
 * with this id is already running.
 */
export function startProviderLogin(
  loginId: string,
  provider: string,
  window: BrowserWindow,
  opts: { readonly onExit?: (code: number) => void } = {},
): void {
  assertSafeProviderName(provider);
  if (runs.has(loginId)) throw new Error('a login with this id is already running');
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('moxxy CLI not found — run the install step first');

  const child = spawnCli(cli, ['login', provider, '--stdin-prompts'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  runs.set(loginId, { child, window });

  const scanner = createLoginStreamScanner();
  child.stdout?.on('data', (b: Buffer) => {
    for (const item of scanner.push(b.toString())) {
      if (item.type === 'prompt') {
        sendEvent(window, 'provider.login.prompt', {
          loginId,
          question: item.prompt.question,
          mask: item.prompt.mask,
        });
      } else if (item.text) {
        sendEvent(window, 'provider.login.output', { loginId, text: item.text });
      }
    }
  });
  // stderr is plain progress/diagnostics — never carries a prompt marker.
  child.stderr?.on('data', (b: Buffer) => {
    sendEvent(window, 'provider.login.output', { loginId, text: b.toString() });
  });

  const finish = (code: number): void => {
    if (!runs.has(loginId)) return; // already finished/cancelled
    runs.delete(loginId);
    sendEvent(window, 'provider.login.done', { loginId, code });
    opts.onExit?.(code);
  };
  child.on('error', (err) => {
    sendEvent(window, 'provider.login.output', { loginId, text: String(err) });
    finish(-1);
  });
  child.on('exit', (code) => finish(code ?? -1));
  // If the window goes away mid-flow, don't leave the CLI blocked on stdin.
  window.once('closed', () => cancelProviderLogin(loginId));
}

/** Feed one answer line (a pasted token or `code#state`) to a running login. */
export function answerProviderLogin(loginId: string, value: string): void {
  const run = runs.get(loginId);
  if (!run) throw new Error('no login is running for this id');
  // One line per prompt; the CLI's stdin reader splits on the newline.
  run.child.stdin?.write(value.replace(/\r?\n/g, '') + '\n');
}

/** Abort a running login (modal closed / cancelled). Safe if already done. */
export function cancelProviderLogin(loginId: string): void {
  const run = runs.get(loginId);
  if (!run) return;
  runs.delete(loginId);
  run.child.kill();
}
