import type { Session } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import { categoryDefault } from './resolve-plugins-tree.js';

/** `@moxxy/plugin-stt-whisper`'s current OpenAI model (not bundled — named here). */
const OPENAI_TRANSCRIBER = 'openai-gpt-transcribe';
/** The OpenAI API key every OpenAI feature shares; the desktop mic reads it too. */
const OPENAI_API_KEY = 'OPENAI_API_KEY';

/**
 * Pick the session's speech-to-text backend at boot, so voice messages to a
 * channel bot (Discord, Telegram, …) transcribe the same way the desktop mic
 * does: the configured `plugins.transcriber.default`, else OpenAI transcription
 * when an OpenAI API key is in the vault. Runs AFTER the plugins' `onInit` — a
 * transcriber builds its client on activation and may need services wired
 * there. Never throws — a backend that cannot start is
 * reported, and without one voice input stays off.
 */
export async function applyTranscriberDefault(
  session: Session,
  config: MoxxyConfig,
  vault: { get(name: string): Promise<string | null> },
  logger: { warn(message: string): void },
): Promise<void> {
  const registry = session.transcribers;
  if (registry.getActiveName()) return;

  const activate = (name: string, options: Record<string, unknown> = {}): boolean => {
    try {
      registry.setActive(name, options);
      return true;
    } catch (err) {
      logger.warn(`transcriber "${name}" could not start: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const configured = categoryDefault(config, 'transcriber');
  if (configured) {
    if (registry.has(configured)) {
      if (activate(configured, config.plugins?.transcriber?.items?.[configured] ?? {})) return;
    } else {
      logger.warn(`transcriber "${configured}" is not installed — voice input falls back to OpenAI when a key is saved`);
    }
  }

  if (!registry.has(OPENAI_TRANSCRIBER)) return;
  const apiKey = await vault.get(OPENAI_API_KEY).then(
    (key) => key?.trim() || null,
    // A locked/unreadable vault just means no OpenAI fallback.
    () => null,
  );
  if (apiKey) activate(OPENAI_TRANSCRIBER, { apiKey });
}
