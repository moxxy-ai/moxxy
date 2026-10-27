/**
 * In-process moxxy plugin host for the desktop.
 *
 * Before this module the desktop was a *pure* thin client — every
 * capability (chat, transcribe, slash commands, …) round-tripped
 * through the runner socket. That works for streamed chat turns but
 * breaks for anything where `RemoteSession` doesn't expose a setter:
 * notably `transcribers.setActive`, which throws on the remote view,
 * so the desktop couldn't activate a cloud transcriber the same way
 * the TUI does in self-host mode.
 *
 * This module flips the model for the slice of capabilities the
 * desktop actually needs to host locally: the main process loads
 * the relevant plugins *directly*, mirroring the TUI's self-host
 * setup. The runner is still the source of truth for chat (turns
 * stream back through the existing SessionDriver IPC pipeline), but
 * voice + future plugin-backed flows talk to instances built here
 * against the same shared vault on disk.
 *
 * Today this hosts the OpenAI cloud transcriber and the GPT-Live session
 * negotiator (Voice Mode's `gpt-live` engine), both on the OpenAI API key. The same pattern
 * generalises: any other plugin we want the desktop to drive in-
 * process is constructed here, given its host dependencies (vault,
 * logger, …), and exposed through `InProcessPlugins` for the IPC
 * handlers to consume.
 */

import { GptLiveSessionClient } from '@moxxy/plugin-provider-openai';
import { buildVaultPlugin, type VaultStore } from '@moxxy/plugin-vault';
import type { Transcriber } from '@moxxy/sdk';
import { createOpenAiTranscriber, OPENAI_API_KEY_NAME } from './openai-transcriber';

/**
 * One-shot bag of plugin instances the desktop's IPC handlers can
 * call without going through the runner socket.
 */
export interface InProcessPlugins {
  /** Vault shared with the runner — same file path
   *  (`~/.moxxy/vault.json`), same key source (combined keychain +
   *  env/passphrase). Written by `moxxy login` and by the desktop's
   *  own key forms (onboarding, Settings → Vault). */
  readonly vault: VaultStore;
  /** Cloud transcriber for the mic: OpenAI on the `OPENAI_API_KEY` saved in
   *  the shared vault. */
  readonly transcriber: Transcriber;
  /** GPT-Live session negotiator on the official OpenAI API, with the
   *  `OPENAI_API_KEY` from the shared vault; the key never leaves the main
   *  process. */
  readonly gptLive: GptLiveSessionClient;
}

/**
 * Build the in-process plugin bag. Calls `buildVaultPlugin()` for
 * its default vault wiring (keychain + env/passphrase key source,
 * `~/.moxxy/vault.json`) so the desktop reads / writes the exact
 * same vault file the TUI does — a key saved by `moxxy` or by the desktop is
 * immediately visible here.
 *
 * Pure function of its inputs (no global state) so tests can swap
 * the vault for an in-memory fake by passing a pre-built one in
 * `opts.vault`.
 */
export function buildInProcessPlugins(
  opts: { readonly vault?: VaultStore; readonly openAiBaseUrl?: string } = {},
): InProcessPlugins {
  const vault = opts.vault ?? buildVaultPlugin().vault;
  const baseURL = opts.openAiBaseUrl ? { baseURL: opts.openAiBaseUrl } : {};
  const transcriber = createOpenAiTranscriber({ vault, ...baseURL });
  const gptLive = new GptLiveSessionClient({
    resolveApiKey: () => vault.get(OPENAI_API_KEY_NAME),
    ...baseURL,
  });
  return { vault, transcriber, gptLive };
}
