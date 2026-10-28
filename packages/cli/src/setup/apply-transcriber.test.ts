import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import { defineTranscriber } from '@moxxy/sdk';
import { applyTranscriberDefault } from './apply-transcriber.js';

const OPENAI = 'openai-gpt-transcribe';

function sessionWith(...names: string[]): Session {
  const session = new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
  for (const name of names) {
    session.transcribers.register(
      defineTranscriber({ name, createClient: () => ({ name, transcribe: async () => ({ text: '' }) }) }),
    );
  }
  return session;
}

/** The vault, as the one secret the OpenAI fallback reads. */
const vaultWith = (secrets: Record<string, string>) => ({
  get: async (name: string) => secrets[name] ?? null,
});
const WITH_KEY = vaultWith({ OPENAI_API_KEY: 'sk-test' });
const NO_KEY = vaultWith({});

function warnings(): { logger: { warn: (m: string) => void }; warns: string[] } {
  const warns: string[] = [];
  return { logger: { warn: (m: string) => void warns.push(m) }, warns };
}

describe('applyTranscriberDefault (voice input for channel bots and the TUI)', () => {
  it('activates the configured transcriber', async () => {
    const session = sessionWith(OPENAI, 'local-whisper');
    const config = { plugins: { transcriber: { default: 'local-whisper' } } } as unknown as MoxxyConfig;

    await applyTranscriberDefault(session, config, WITH_KEY, warnings().logger);

    expect(session.transcribers.getActiveName()).toBe('local-whisper');
  });

  it('falls back to OpenAI transcription on the OpenAI API key in the vault', async () => {
    let options: unknown;
    const session = new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
    session.transcribers.register(defineTranscriber({
      name: OPENAI,
      createClient: (config) => {
        options = config;
        return { name: OPENAI, transcribe: async () => ({ text: '' }) };
      },
    }));

    await applyTranscriberDefault(session, {} as MoxxyConfig, WITH_KEY, warnings().logger);

    expect(session.transcribers.getActiveName()).toBe(OPENAI);
    expect(options).toEqual({ apiKey: 'sk-test' });
  });

  it('never falls back to the retired ChatGPT sign-in transcriber', async () => {
    const session = sessionWith('openai-codex-transcribe');

    await applyTranscriberDefault(
      session, {} as MoxxyConfig, vaultWith({ 'oauth/openai-codex/refresh_token': 'r' }), warnings().logger,
    );

    expect(session.transcribers.getActiveName()).toBeNull();
  });

  it('leaves voice input off without a configured backend or an OpenAI API key', async () => {
    const session = sessionWith(OPENAI);

    await applyTranscriberDefault(session, {} as MoxxyConfig, NO_KEY, warnings().logger);

    expect(session.transcribers.getActiveName()).toBeNull();
  });

  it('warns about a configured transcriber that is not installed, then falls back', async () => {
    const session = sessionWith(OPENAI);
    const { logger, warns } = warnings();
    const config = { plugins: { transcriber: { default: 'missing' } } } as unknown as MoxxyConfig;

    await applyTranscriberDefault(session, config, WITH_KEY, logger);

    expect(warns.join('\n')).toMatch(/missing/u);
    expect(session.transcribers.getActiveName()).toBe(OPENAI);
  });

  it('keeps a transcriber a plugin already activated', async () => {
    const session = sessionWith(OPENAI, 'local-whisper');
    session.transcribers.setActive('local-whisper');

    await applyTranscriberDefault(session, {} as MoxxyConfig, WITH_KEY, warnings().logger);

    expect(session.transcribers.getActiveName()).toBe('local-whisper');
  });

  it('reports a backend that cannot start instead of silently leaving voice off', async () => {
    const session = new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
    session.transcribers.register(
      defineTranscriber({
        name: OPENAI,
        createClient: () => {
          throw new Error('the "vault" service is unavailable');
        },
      }),
    );
    const { logger, warns } = warnings();

    await applyTranscriberDefault(session, {} as MoxxyConfig, WITH_KEY, logger);

    expect(session.transcribers.getActiveName()).toBeNull();
    expect(warns.join('\n')).toMatch(/vault/u);
  });
});
