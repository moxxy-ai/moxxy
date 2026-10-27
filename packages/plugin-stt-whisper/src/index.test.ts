import { describe, expect, it } from 'vitest';
import plugin, { buildWhisperPlugin } from './index.js';

describe('@moxxy/plugin-stt-whisper', () => {
  it('registers the current OpenAI model and keeps whisper-1 for existing configs', () => {
    expect(plugin.transcribers?.map((def) => def.name)).toEqual(['openai-gpt-transcribe', 'openai-whisper-1']);
  });

  it('still builds a single-model plugin on request', () => {
    expect(buildWhisperPlugin({ model: 'gpt-4o-transcribe' }).transcribers?.map((def) => def.name))
      .toEqual(['openai-gpt-4o-transcribe']);
  });
});
