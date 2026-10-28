import { describe, expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { definePlugin, defineTranscriber } from '@moxxy/sdk';
import {
  checkVoiceInputReady,
  combineVoiceInputReadiness,
  formatVoiceReadinessNotice,
  resolveVoiceTranscriber,
} from './use-voice-input.js';

function makeSession(): Session {
  const session = new Session({ cwd: '/tmp', logger: silentLogger });
  session.pluginHost.registerStatic(
    definePlugin({
      name: '@test/voice',
      transcribers: [
        defineTranscriber({
          name: 'openai-gpt-transcribe',
          createClient: () => ({ name: 'openai-gpt-transcribe', transcribe: async () => ({ text: 'openai' }) }),
        }),
        defineTranscriber({
          name: 'local-whisper',
          createClient: () => ({ name: 'local-whisper', transcribe: async () => ({ text: 'local' }) }),
        }),
      ],
    }),
  );
  return session;
}

describe('TUI voice input readiness', () => {
  it('is unavailable until a transcriber is active, and says how to set one up', () => {
    const session = makeSession();

    const check = checkVoiceInputReady(session);

    expect(check.ready).toBe(false);
    expect(formatVoiceReadinessNotice(check)).toBe(
      'voice: no transcription is set up. Save OPENAI_API_KEY with /vault set, or set plugins.transcriber.default, then restart',
    );
    expect(() => resolveVoiceTranscriber(session)).toThrow(/no transcription is set up/);
  });

  it('uses whichever transcriber is active, with any provider', () => {
    const session = makeSession();
    session.transcribers.setActive('local-whisper');

    expect(checkVoiceInputReady(session)).toEqual({ ready: true, issues: [] });
    expect(resolveVoiceTranscriber(session).name).toBe('local-whisper');
    expect(session.transcribers.getActiveName()).toBe('local-whisper');
  });

  it('is unavailable when local ffmpeg capture is not ready', () => {
    const session = makeSession();
    session.transcribers.setActive('openai-gpt-transcribe');

    const check = combineVoiceInputReadiness(checkVoiceInputReady(session), {
      ready: false,
      issues: [
        {
          requirement: { kind: 'runtime', name: 'voice:capture:ffmpeg', state: 'ready' },
          code: 'not_ready',
          message: 'ffmpeg is required for voice input',
          hint: 'Install ffmpeg and ensure it is available on PATH.',
        },
      ],
    });

    expect(check.ready).toBe(false);
    const notice = formatVoiceReadinessNotice(check);
    expect(notice).toContain('voice: ffmpeg is required for voice input');
    // Second line is the platform-specific install command — exact text
    // depends on the host running the test, so just assert structure.
    expect(notice.split('\n')).toHaveLength(2);
    expect(notice).toMatch(/Install via .+:\s+/);
  });
});
