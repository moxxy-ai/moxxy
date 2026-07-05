import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureModel } from './ensure-model.js';
import type { FetchLike } from './fetch-asset.js';

function have(cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const FIXTURES_OK = process.platform !== 'win32' && have('tar') && have('bzip2');
const URL_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

let fixtureBytes: Uint8Array;
let fixtureHash: string;

beforeAll(async () => {
  if (!FIXTURES_OK) return;
  const base = await mkdtemp(path.join(tmpdir(), 'ensure-fix-'));
  await mkdir(path.join(base, 'vits-piper-en_US-amy-medium'), { recursive: true });
  await writeFile(path.join(base, 'vits-piper-en_US-amy-medium', 'en_US-amy-medium.onnx'), 'MODEL');
  await writeFile(path.join(base, 'vits-piper-en_US-amy-medium', 'tokens.txt'), 'a 0');
  const archive = path.join(base, 'voice.tar.bz2');
  execFileSync('tar', ['-cjf', archive, '-C', base, 'vits-piper-en_US-amy-medium']);
  fixtureBytes = new Uint8Array(await readFile(archive));
  fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex');
  await rm(base, { recursive: true, force: true });
});

/** A `fetch` serving the fixture archive bytes; counts invocations. */
function serveFixture(): { fetchImpl: FetchLike; calls: () => number } {
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls += 1;
    return new Response(fixtureBytes, {
      status: 200,
      headers: { 'content-length': String(fixtureBytes.byteLength) },
    });
  }) as unknown as FetchLike;
  return { fetchImpl, calls: () => state.calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ensure-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
afterAll(() => {});

describe.skipIf(!FIXTURES_OK)('ensureModel', () => {
  it('downloads + extracts on first use, then skips on the second call', async () => {
    const modelDir = path.join(dir, 'en_US-amy-medium');
    const first = serveFixture();
    const phases: string[] = [];
    const res = await ensureModel({
      url: `${URL_BASE}/voice.tar.bz2`,
      sha256: fixtureHash,
      dir: modelDir,
      fetchImpl: first.fetchImpl,
      onProgress: (p) => phases.push(p.phase),
    });
    expect(res.skipped).toBe(false);
    expect(first.calls()).toBe(1);
    // Extracted tree is present…
    expect(
      await readFile(path.join(modelDir, 'vits-piper-en_US-amy-medium', 'en_US-amy-medium.onnx'), 'utf8'),
    ).toBe('MODEL');
    // …the completion marker recorded the hash…
    expect((await readFile(path.join(modelDir, '.model.ok'), 'utf8')).trim()).toBe(fixtureHash);
    // …and the staged archive was reclaimed.
    await expect(stat(path.join(dir, 'voice.tar.bz2'))).rejects.toThrow();
    expect(phases).toContain('extracting');
    expect(phases.at(-1)).toBe('done');

    // Second call: the network must not be touched.
    const explode = (async () => {
      throw new Error('must not download again');
    }) as unknown as FetchLike;
    const again = await ensureModel({
      url: `${URL_BASE}/voice.tar.bz2`,
      sha256: fixtureHash,
      dir: modelDir,
      fetchImpl: explode,
    });
    expect(again.skipped).toBe(true);
  });

  it('propagates an integrity mismatch and leaves no marker', async () => {
    const modelDir = path.join(dir, 'bad');
    const { fetchImpl } = serveFixture();
    await expect(
      ensureModel({
        url: `${URL_BASE}/voice.tar.bz2`,
        sha256: 'a'.repeat(64),
        dir: modelDir,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    await expect(stat(path.join(modelDir, '.model.ok'))).rejects.toThrow();
  });
});
