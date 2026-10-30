import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE,
  SUPERTONIC_LANGUAGES,
  VOICE_CATALOG,
  voiceModelPaths,
  speechLanguage,
} from './voices.js';

describe('VOICE_CATALOG', () => {
  it('pins Supertonic 3 with its sherpa checksum.txt sha256', () => {
    expect(VOICE_CATALOG).toHaveLength(1);
    const [voice] = VOICE_CATALOG;
    expect(voice?.url).toBe(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2',
    );
    expect(voice?.sha256).toBe('82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427');
    expect(voice?.archiveRootDir).toBe('sherpa-onnx-supertonic-3-tts-int8-2026-05-11');
  });

  it('speaks with the F2 preset', () => {
    expect(DEFAULT_VOICE.speakerId).toBe(1);
    expect(DEFAULT_VOICE.preset).toBe('F2');
  });

  it('resolves every file sherpa needs under the extracted archive', () => {
    const root = ['/models', DEFAULT_VOICE.id, DEFAULT_VOICE.archiveRootDir].join('/');
    expect(voiceModelPaths(DEFAULT_VOICE, '/models')).toEqual({
      durationPredictor: `${root}/duration_predictor.int8.onnx`,
      textEncoder: `${root}/text_encoder.int8.onnx`,
      vectorEstimator: `${root}/vector_estimator.int8.onnx`,
      vocoder: `${root}/vocoder.int8.onnx`,
      ttsJson: `${root}/tts.json`,
      unicodeIndexer: `${root}/unicode_indexer.bin`,
      voiceStyle: `${root}/voice.bin`,
    });
  });
});

describe('speechLanguage', () => {
  it('takes the primary subtag of a supported hint', () => {
    expect(speechLanguage('pl', 'x')).toBe('pl');
    expect(speechLanguage('pl-PL', 'x')).toBe('pl');
    expect(speechLanguage('PL_pl', 'x')).toBe('pl');
    expect(speechLanguage('de', 'x')).toBe('de');
    expect(speechLanguage(' en-US ', 'x')).toBe('en');
  });

  it('knows the 31 languages of Supertonic 3', () => {
    expect(SUPERTONIC_LANGUAGES.size).toBe(31);
  });

  it('detects Polish or English from the text when no hint is given', () => {
    expect(speechLanguage(undefined, 'Dzień dobry, czy to już działa?')).toBe('pl');
    expect(speechLanguage(undefined, 'The task is finished and the tests pass.')).toBe('en');
  });

  it('falls back to the text when the hint is a language the model cannot speak', () => {
    expect(speechLanguage('zh', 'Dzień dobry, czy to już działa?')).toBe('pl');
    expect(speechLanguage('zh', 'The task is finished.')).toBe('en');
  });
});
