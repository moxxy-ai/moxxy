import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_ID,
  findModel,
  modelBytes,
  modelDir,
  modelFiles,
  modelIds,
  requireModel,
} from './models.js';

describe('MODEL_CATALOG', () => {
  const HF = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/2ca6ff69fc878651b770880507669577ac41c2ff';

  it('pins only Whisper turbo, as its three int8 files on a fixed Hugging Face revision', () => {
    expect(modelIds()).toEqual(['turbo']);
    const turbo = findModel('turbo')!;
    expect(turbo.encoder).toEqual({
      name: 'turbo-encoder.int8.onnx',
      url: `${HF}/turbo-encoder.int8.onnx`,
      bytes: 674_716_297,
      sha256: 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b',
    });
    expect(turbo.decoder).toEqual({
      name: 'turbo-decoder.int8.onnx',
      url: `${HF}/turbo-decoder.int8.onnx`,
      bytes: 361_080_764,
      sha256: '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547',
    });
    expect(turbo.tokens).toEqual({
      name: 'turbo-tokens.txt',
      url: `${HF}/turbo-tokens.txt`,
      bytes: 816_730,
      sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    });
  });

  it('lists the files of a model and their total size', () => {
    const turbo = findModel('turbo')!;
    expect(modelFiles(turbo).map((file) => file.name)).toEqual([
      'turbo-encoder.int8.onnx',
      'turbo-decoder.int8.onnx',
      'turbo-tokens.txt',
    ]);
    expect(modelBytes(turbo)).toBe(674_716_297 + 361_080_764 + 816_730);
  });

  it('keeps each model in its own directory under the models root', () => {
    expect(modelDir(findModel('turbo')!, '/home/me/.moxxy/models/stt')).toBe(
      path.join('/home/me/.moxxy/models/stt', 'turbo'),
    );
  });

  it('defaults to turbo', () => {
    expect(DEFAULT_MODEL_ID).toBe('turbo');
    expect(findModel(DEFAULT_MODEL_ID)).toBeDefined();
  });
});

describe('requireModel', () => {
  it('returns the catalog entry for a known id', () => {
    expect(requireModel('turbo', 'model').id).toBe('turbo');
  });

  it('rejects the removed tiny/base/small models with CONFIG_INVALID naming turbo', () => {
    for (const removed of ['tiny', 'base', 'small']) {
      try {
        requireModel(removed, 'model');
        expect.unreachable(`${removed} should be rejected`);
      } catch (err) {
        expect((err as { code?: string }).code).toBe('CONFIG_INVALID');
        expect((err as Error).message).toMatch(/Unknown local Whisper model/);
        expect((err as { hint?: string }).hint).toBe('Valid models: turbo.');
      }
    }
  });
});
