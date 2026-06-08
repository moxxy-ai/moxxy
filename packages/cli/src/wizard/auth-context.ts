/**
 * Helpers that bridge the CLI's runtime (vault store, stdout) to the
 * provider-agnostic `ProviderAuthContext` declared in `@moxxy/sdk`. Every
 * `moxxy login` and `moxxy init` call funnels through here so the OAuth
 * dance is identical regardless of which provider plugin owns it.
 */

import { MoxxyError, type ProviderAuthContext, type ProviderDef } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { isCancel, password, text } from '@clack/prompts';

export interface BuildAuthContextOptions {
  readonly headless: boolean;
  /** Defaults to writing through `process.stdout`. Wizard hosts pass a clack-aware writer. */
  readonly write?: (chunk: string) => void;
}

export function buildProviderAuthContext(
  vault: VaultStore,
  opts: BuildAuthContextOptions,
): ProviderAuthContext {
  return {
    headless: opts.headless,
    write: opts.write ?? ((s) => process.stdout.write(s)),
    // A TTY-only single-line input used by out-of-band / paste flows (e.g.
    // claude-code). Omitted in headless mode so those flows fail fast with a
    // "set the env var instead" message rather than hanging on a dead stdin.
    ...(opts.headless ? {} : { prompt: clackPrompt }),
    vault: {
      get: (key) => vault.get(key),
      set: (key, value, tags) => vault.set(key, value, tags ? [...tags] : undefined),
      delete: (key) => vault.delete(key),
    },
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
