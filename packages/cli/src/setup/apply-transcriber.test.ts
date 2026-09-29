import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import { defineTranscriber } from '@moxxy/sdk';
import { applyTranscriberDefault } from './apply-transcriber.js';

const CODEX = 'openai-codex-transcribe';

function sessionWith(...names: string[]): Session {
  const session = new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
  for (const name of names) {
    session.transcribers.register(
      defineTranscriber({ name, createClient: () => ({ name, transcribe: async () => ({ text: '' }) }) }),
    );
  }
  return session;
}

/** The vault, as the one secret the Codex fallback reads. */
const vaultWith = (secrets: Record<string, string>) => ({
  get: async (name: string) => secrets[name] ?? null,
});
const LOGGED_IN = vaultWith({ 'oauth/openai-codex/refresh_token': 'r' });
const LOGGED_OUT = vaultWith({});

function warnings(): { logger: { warn: (m: string) => void }; warns: string[] } {
  const warns: string[] = [];
  return { logger: { warn: (m: string) => void warns.push(m) }, warns };
}

describe('applyTranscriberDefault (voice input for channel bots and the TUI)', () => {
  it('activates the configured transcriber', async () => {
    const session = sessionWith(CODEX, 'local-whisper');
    const config = { plugins: { transcriber: { default: 'local-whisper' } } } as unknown as MoxxyConfig;

    await applyTranscriberDefault(session, config, LOGGED_IN, warnings().logger);

    expect(session.transcribers.getActiveName()).toBe('local-whisper');
  });

  it('falls back to Codex transcription when you are logged in with ChatGPT', async () => {
    const session = sessionWith(CODEX);

    await applyTranscriberDefault(session, {} as MoxxyConfig, LOGGED_IN, warnings().logger);

    expect(session.transcribers.getActiveName()).toBe(CODEX);
  });

  it('leaves voice input off without a configured backend or a ChatGPT login', async () => {
    const session = sessionWith(CODEX);

    await applyTranscriberDefault(session, {} as MoxxyConfig, LOGGED_OUT, warnings().logger);

    expect(session.transcribers.getActiveName()).toBeNull();
  });

  it('warns about a configured transcriber that is not installed, then falls back', async () => {
    const session = sessionWith(CODEX);
    const { logger, warns } = warnings();
    const config = { plugins: { transcriber: { default: 'missing' } } } as unknown as MoxxyConfig;

    await applyTranscriberDefault(session, config, LOGGED_IN, logger);

    expect(warns.join('\n')).toMatch(/missing/u);
    expect(session.transcribers.getActiveName()).toBe(CODEX);
  });

  it('keeps a transcriber a plugin already activated', async () => {
    const session = sessionWith(CODEX, 'local-whisper');
    session.transcribers.setActive('local-whisper');

    await applyTranscriberDefault(session, {} as MoxxyConfig, LOGGED_IN, warnings().logger);

    expect(session.transcribers.getActiveName()).toBe('local-whisper');
  });
});
