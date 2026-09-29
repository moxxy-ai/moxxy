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
 * when you are logged in with ChatGPT. Runs AFTER the plugins' `onInit` — a
 * transcriber builds its client on activation and may need services wired
 * there (Codex needs the vault). Never throws — a backend that cannot start is
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
      logger.warn(`transcriber "${configured}" is not installed — voice input falls back to Codex when available`);
    }
  }

  if (!registry.has(CODEX_TRANSCRIBER)) return;
  const loggedIn = await vault.get(CODEX_REFRESH_TOKEN).then(
    (token) => token != null,
    // A locked/unreadable vault just means no Codex fallback.
    () => false,
  );
  if (loggedIn) activate(CODEX_TRANSCRIBER);
}
