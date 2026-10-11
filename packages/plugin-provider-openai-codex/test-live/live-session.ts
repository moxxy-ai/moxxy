import { existsSync } from 'node:fs';
import { collectTurn, type Session } from '@moxxy/core';
import { defaultModePlugin } from '@moxxy/mode-default';
import { buildVaultPlugin, defaultVaultPath } from '@moxxy/plugin-vault';
import { createFakeSession } from '@moxxy/testing';
import type { LLMProvider, MoxxyEvent, RunTurnOptions, ToolDef } from '@moxxy/sdk';
import { openaiCodexProviderDef } from '../src/index.js';

/** The model and settings real moxxy trials run on. */
export const LIVE_MODEL = 'gpt-6-luna';

export type LiveCodex = { readonly provider: LLMProvider } | { readonly skip: string };

/**
 * The provider exactly as the CLI builds it, signed in with the developer's own
 * ChatGPT login from their vault. Never creates a vault: a missing one means
 * nobody signed in here, and writing a fresh one would be a side effect.
 */
export async function openLiveCodex(): Promise<LiveCodex> {
  if (process.env.CI) return { skip: 'the live check never runs in CI: it signs in with a personal ChatGPT account' };
  if (!existsSync(defaultVaultPath())) return { skip: 'no moxxy vault here — sign in with `moxxy login openai-codex`' };
  const { vault } = buildVaultPlugin({
    passphrasePrompt: () => Promise.reject(new Error('the vault is locked — set MOXXY_VAULT_PASSPHRASE')),
  });
  try {
    await vault.open();
    const config = await openaiCodexProviderDef.resolveCredentials?.({ vault, providerConfig: {}, host: { cwd: process.cwd() } });
    if (!config) return { skip: 'the Codex provider resolves no credentials' };
    return { provider: openaiCodexProviderDef.createClient(config) };
  } catch (err) {
    return { skip: `no usable ChatGPT sign-in: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** A session on the default mode, driving the live provider at the trial settings. */
export function liveSession(provider: LLMProvider, opts: { readonly tools?: ReadonlyArray<ToolDef>; readonly reasoning?: boolean } = {}): Session {
  const session = createFakeSession({ provider, plugins: [defaultModePlugin] });
  for (const tool of opts.tools ?? []) session.tools.register(tool);
  session.fast = true;
  session.reasoning = opts.reasoning === false ? undefined : { effort: 'medium' };
  return session;
}

export function liveTurn(session: Session, prompt: string, opts: RunTurnOptions = {}): Promise<ReadonlyArray<MoxxyEvent>> {
  return collectTurn(session, prompt, { model: LIVE_MODEL, ...opts });
}

/** Every error a turn reported, as text the failure message can show. */
export function errorsOf(events: ReadonlyArray<MoxxyEvent>): string[] {
  return events.flatMap((event) => (event.type === 'error' ? [JSON.stringify(event)] : []));
}

export function finalText(events: ReadonlyArray<MoxxyEvent>): string {
  const messages = events.filter((event) => event.type === 'assistant_message');
  const last = messages[messages.length - 1];
  return last && last.type === 'assistant_message' ? last.content : '';
}
