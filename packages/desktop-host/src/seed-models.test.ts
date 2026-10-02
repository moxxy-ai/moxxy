import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { seedModelsFromResources } from './seed-models.js';

let tmp: string;
let resources: string;
let home: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-seed-models-'));
  resources = path.join(tmp, 'resources');
  home = path.join(tmp, 'home');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeModel(root: string, kind: string, id: string, marker: string | null) {
  const dir = path.join(root, kind, id);
  await fs.mkdir(path.join(dir, 'espeak-ng-data'), { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.onnx`), `model ${id}`);
  await fs.writeFile(path.join(dir, 'espeak-ng-data', 'phontab'), 'phonemes');
  if (marker !== null) await fs.writeFile(path.join(dir, '.model.ok'), `${marker}\n`);
  return dir;
}

const seedRoot = () => path.join(resources, 'models-seed');
const homeRoot = () => path.join(home, 'models');

describe('seedModelsFromResources', () => {
  it('copies every bundled model so the first use needs no download', async () => {
    await makeModel(seedRoot(), 'tts', 'en_US-amy-medium', 'aaa');
    await makeModel(seedRoot(), 'tts', 'pl_PL-gosia-medium', 'bbb');

    const result = await seedModelsFromResources({ resourcesPath: resources, moxxyHome: home });

    expect([...result.copied].sort()).toEqual(['tts/en_US-amy-medium', 'tts/pl_PL-gosia-medium']);
    expect(result.skipped).toEqual([]);
    const voice = path.join(homeRoot(), 'tts', 'pl_PL-gosia-medium');
    expect(await fs.readFile(path.join(voice, 'pl_PL-gosia-medium.onnx'), 'utf8')).toBe('model pl_PL-gosia-medium');
    expect(await fs.readFile(path.join(voice, 'espeak-ng-data', 'phontab'), 'utf8')).toBe('phonemes');
    expect((await fs.readFile(path.join(voice, '.model.ok'), 'utf8')).trim()).toBe('bbb');
  });

  it('leaves a model the user already has untouched', async () => {
    await makeModel(seedRoot(), 'tts', 'en_US-amy-medium', 'aaa');
    const existing = await makeModel(homeRoot(), 'tts', 'en_US-amy-medium', 'aaa');
    await fs.writeFile(path.join(existing, 'en_US-amy-medium.onnx'), 'the copy already on disk');

    const result = await seedModelsFromResources({ resourcesPath: resources, moxxyHome: home });

    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual(['tts/en_US-amy-medium']);
    expect(await fs.readFile(path.join(existing, 'en_US-amy-medium.onnx'), 'utf8')).toBe('the copy already on disk');
  });

  it('replaces a model whose download never finished', async () => {
    await makeModel(seedRoot(), 'tts', 'en_US-amy-medium', 'aaa');
    const partial = await makeModel(homeRoot(), 'tts', 'en_US-amy-medium', null);
    await fs.writeFile(path.join(partial, 'en_US-amy-medium.onnx'), 'half a file');

    const result = await seedModelsFromResources({ resourcesPath: resources, moxxyHome: home });

    expect(result.copied).toEqual(['tts/en_US-amy-medium']);
    expect(await fs.readFile(path.join(partial, 'en_US-amy-medium.onnx'), 'utf8')).toBe('model en_US-amy-medium');
    expect((await fs.readFile(path.join(partial, '.model.ok'), 'utf8')).trim()).toBe('aaa');
  });

  it('ignores a bundled directory that is not a finished model', async () => {
    await makeModel(seedRoot(), 'tts', 'en_US-amy-medium', null);

    const result = await seedModelsFromResources({ resourcesPath: resources, moxxyHome: home });

    expect(result).toEqual({ copied: [], skipped: [] });
    await expect(fs.access(path.join(homeRoot(), 'tts', 'en_US-amy-medium'))).rejects.toThrow();
  });

  it('does nothing when the app ships no models', async () => {
    const result = await seedModelsFromResources({ resourcesPath: resources, moxxyHome: home });

    expect(result).toEqual({ copied: [], skipped: [] });
    await expect(fs.access(homeRoot())).rejects.toThrow();
  });

  it('leaves no half-copied directory behind', async () => {
    await makeModel(seedRoot(), 'tts', 'en_US-amy-medium', 'aaa');

    await seedModelsFromResources({ resourcesPath: resources, moxxyHome: home });

    expect(await fs.readdir(path.join(homeRoot(), 'tts'))).toEqual(['en_US-amy-medium']);
  });
});
