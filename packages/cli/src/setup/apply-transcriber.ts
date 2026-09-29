import type { Session } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import { categoryDefault } from './resolve-plugins-tree.js';

/** `@moxxy/plugin-stt-whisper-codex`'s transcriber (not bundled — named here). */
const CODEX_TRANSCRIBER = 'openai-codex-transcribe';
/** Written by `moxxy login openai-codex`; the desktop's voice fallback reads it too. */
const CODEX_REFRESH_TOKEN = 'oauth/openai-codex/refresh_token';

/**
 * Pick the session's speech-to-text backend at boot, so voice messages to a
 * channel bot (Discord, Telegram, …) transcribe the same way the desktop mic
 * does: the configured `plugins.transcriber.default`, else Codex transcription
 * when you are logged in with ChatGPT. Never throws — without either, voice
 * input just stays off (channels explain that when a voice note arrives).
 */
export async function applyTranscriberDefault(
  session: Session,
  config: MoxxyConfig,
  vault: { get(name: string): Promise<string | null> },
  logger: { warn(message: string): void },
): Promise<void> {
  const registry = session.transcribers;
  if (registry.getActiveName()) return;

  const configured = categoryDefault(config, 'transcriber');
  if (configured) {
    if (registry.has(configured)) {
      registry.setActive(configured, config.plugins?.transcriber?.items?.[configured] ?? {});
      return;
    }
    logger.warn(`transcriber "${configured}" is not installed — voice input falls back to Codex when available`);
  }

  if (!registry.has(CODEX_TRANSCRIBER)) return;
  try {
    if ((await vault.get(CODEX_REFRESH_TOKEN)) != null) registry.setActive(CODEX_TRANSCRIBER);
  } catch {
    // A locked/unreadable vault just means no Codex fallback.
  }
}
