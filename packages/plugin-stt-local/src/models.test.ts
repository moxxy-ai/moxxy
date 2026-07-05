import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  findModel,
  modelIds,
  requireModel,
} from './models.js';

describe('MODEL_CATALOG', () => {
  it('pins tiny/base/small multilingual models with their release URLs + hashes', () => {
    expect(modelIds()).toEqual(['tiny', 'base', 'small']);
    for (const m of MODEL_CATALOG) {
      expect(m.url).toBe(
        `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-${m.id}.tar.bz2`,
      );
      expect(m.archiveRootDir).toBe(`sherpa-onnx-whisper-${m.id}`);
      expect(m.encoderFile).toBe(`${m.id}-encoder.onnx`);
      expect(m.decoderFile).toBe(`${m.id}-decoder.onnx`);
      expect(m.tokensFile).toBe(`${m.id}-tokens.txt`);
      // 64-hex sha256, lower-case.
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('records the scout-verified checksums verbatim', () => {
    expect(findModel('tiny')!.sha256).toBe(
      'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1',
    );
    expect(findModel('base')!.sha256).toBe(
      '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de',
    );
    expect(findModel('small')!.sha256).toBe(
      '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6',
    );
  });

  it('defaults to base', () => {
    expect(DEFAULT_MODEL_ID).toBe('base');
    expect(findModel(DEFAULT_MODEL_ID)).toBeDefined();
  });
});

describe('requireModel', () => {
  it('returns the catalog entry for a known id', () => {
    expect(requireModel('small', 'model').id).toBe('small');
  });

  it('throws CONFIG_INVALID with the valid ids for an unknown model', () => {
    expect(() => requireModel('medium', 'model')).toThrow(/Unknown local Whisper model/);
    try {
      requireModel('medium', 'model');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CONFIG_INVALID');
      expect((err as { hint?: string }).hint).toContain('tiny, base, small');
    }
  });
});
