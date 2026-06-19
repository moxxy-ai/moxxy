import { definePlugin, defineTranscriber, type Plugin } from '@moxxy/sdk';
import {
  CodexOAuthTranscriber,
  OPENAI_CODEX_TRANSCRIBER_NAME,
  type CodexOAuthTranscriberOptions,
  type CodexOAuthVault,
} from './transcriber.js';

export {
  CodexOAuthTranscriber,
  DEFAULT_CODEX_TRANSCRIBE_BASE_URL,
  MOXXY_PCM16_24KHZ_MIME,
  OPENAI_CODEX_TRANSCRIBER_NAME,
  buildCodexTranscribeUrl,
  type CodexOAuthTranscriberOptions,
  type CodexOAuthVault,
} from './transcriber.js';
// pcm16MonoToWav was moved into @moxxy/plugin-stt-whisper alongside the
// rest of the shared audio helpers; re-export it here so older callers
// that import it from this package keep compiling.
export { pcm16MonoToWav } from '@moxxy/plugin-stt-whisper';

export interface BuildWhisperCodexPluginOptions {
  readonly vault: CodexOAuthVault;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly sessionIdProvider?: () => string;
  /** Whole-request deadline in ms; defaults to 60s. `<= 0` disables it. */
  readonly requestTimeoutMs?: number;
}

export function buildWhisperCodexPlugin(
  opts: BuildWhisperCodexPluginOptions,
): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-stt-whisper-codex',
    version: '0.0.0',
    transcribers: [
      defineTranscriber({
        name: OPENAI_CODEX_TRANSCRIBER_NAME,
        displayName: 'OpenAI Codex transcription (OAuth)',
        createClient: (config) => {
          // Only `baseUrl`/`sessionIdProvider` are caller-overridable; the
          // host-wired `vault`/`fetch` stay authoritative so a stray config
          // key cannot shadow a required dependency. Read narrow, typed keys
          // off the untrusted `config` rather than spreading it wholesale.
          const cfg = (config ?? {}) as {
            baseUrl?: unknown;
            sessionIdProvider?: unknown;
          };
          const configBaseUrl =
            typeof cfg.baseUrl === 'string' ? cfg.baseUrl : undefined;
          const configSessionIdProvider =
            typeof cfg.sessionIdProvider === 'function'
              ? (cfg.sessionIdProvider as () => string)
              : undefined;
          const baseUrl = configBaseUrl ?? opts.baseUrl;
          const sessionIdProvider =
            configSessionIdProvider ?? opts.sessionIdProvider;
          const merged: CodexOAuthTranscriberOptions = {
            vault: opts.vault,
            ...(baseUrl ? { baseUrl } : {}),
            ...(opts.fetch ? { fetch: opts.fetch } : {}),
            ...(sessionIdProvider ? { sessionIdProvider } : {}),
            ...(opts.requestTimeoutMs !== undefined
              ? { requestTimeoutMs: opts.requestTimeoutMs }
              : {}),
          };
          return new CodexOAuthTranscriber(merged);
        },
      }),
    ],
  });
}
