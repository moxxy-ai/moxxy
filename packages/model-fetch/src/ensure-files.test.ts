import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelFetchError } from './errors.js';
import { ensureModelFiles, modelFilesReady, type ModelFile, type ModelFilesProgress } from './ensure-files.js';
import type { FetchLike } from './fetch-asset.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

const BASE = 'https://huggingface.co/org/model/resolve/0123456789abcdef';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function modelFile(name: string, bytes: Uint8Array): ModelFile {
  return { name, url: `${BASE}/${name}`, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

const ENCODER = new Uint8Array(4096).fill(1);
const DECODER = new Uint8Array(2048).fill(2);
const TOKENS = new TextEncoder().encode('a 0\nb 1\n');
const FILES = [modelFile('encoder.onnx', ENCODER), modelFile('decoder.onnx', DECODER), modelFile('tokens.txt', TOKENS)];
const BODIES = new Map<string, Uint8Array>([
  [FILES[0]!.url, ENCODER],
  [FILES[1]!.url, DECODER],
  [FILES[2]!.url, TOKENS],
]);

/** A `fetch` serving each file's bytes by url, counting requests. */
function serve(bodies: ReadonlyMap<string, Uint8Array> = BODIES): { fetchImpl: FetchLike; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    requested.push(url);
    const body = bodies.get(url);
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength) } });
  }) as unknown as FetchLike;
  return { fetchImpl, requested };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'model-files-'));
});
afterEach(async () => {
  await removeDir(dir);
});

describe('ensureModelFiles', () => {
  it('downloads every file straight into the model directory, with no archive to unpack', async () => {
    const { fetchImpl, requested } = serve();
    const modelDir = path.join(dir, 'turbo');

    const result = await ensureModelFiles({ files: FILES, dir: modelDir, fetchImpl });

    expect(result).toEqual({ dir: modelDir, skipped: false });
    expect(requested.sort()).toEqual(FILES.map((file) => file.url).sort());
    expect(new Uint8Array(await readFile(path.join(modelDir, 'encoder.onnx')))).toEqual(ENCODER);
    expect(new Uint8Array(await readFile(path.join(modelDir, 'decoder.onnx')))).toEqual(DECODER);
    expect(await readFile(path.join(modelDir, 'tokens.txt'), 'utf8')).toBe('a 0\nb 1\n');
  });

  it('reports progress over the whole model and ends at its full size', async () => {
    const { fetchImpl } = serve();
    const seen: ModelFilesProgress[] = [];

    await ensureModelFiles({ files: FILES, dir, fetchImpl, onProgress: (p) => seen.push(p) });

    const total = ENCODER.byteLength + DECODER.byteLength + TOKENS.byteLength;
    expect(seen.every((p) => p.totalBytes === total)).toBe(true);
    expect(seen.at(-1)).toEqual({ receivedBytes: total, totalBytes: total });
    const received = seen.map((p) => p.receivedBytes);
    expect(received).toEqual([...received].sort((a, b) => a - b));
  });

  it('fetches nothing when every file is already on disk and verified', async () => {
    await ensureModelFiles({ files: FILES, dir, fetchImpl: serve().fetchImpl });
    const again = serve();

    const result = await ensureModelFiles({ files: FILES, dir, fetchImpl: again.fetchImpl });

    expect(result.skipped).toBe(true);
    expect(again.requested).toEqual([]);
  });

  it('downloads only the file that is missing, counting the others as done', async () => {
    await ensureModelFiles({ files: FILES, dir, fetchImpl: serve().fetchImpl });
    await removeDir(path.join(dir, 'decoder.onnx'));
    const again = serve();
    const seen: ModelFilesProgress[] = [];

    await ensureModelFiles({ files: FILES, dir, fetchImpl: again.fetchImpl, onProgress: (p) => seen.push(p) });

    expect(again.requested).toEqual([FILES[1]!.url]);
    expect(seen[0]!.receivedBytes).toBeGreaterThanOrEqual(ENCODER.byteLength + TOKENS.byteLength);
  });

  it('rejects a file whose bytes do not match the pinned checksum and keeps nothing of it', async () => {
    const tampered = new Map(BODIES);
    tampered.set(FILES[2]!.url, new TextEncoder().encode('x 0\nb 1\n'));

    const error = await ensureModelFiles({ files: FILES, dir, fetchImpl: serve(tampered).fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(ModelFetchError);
    expect((error as ModelFetchError).code).toBe('INTEGRITY_MISMATCH');
    expect(await modelFilesReady(FILES, dir)).toBe(false);
  });

  it('refuses a file larger than its pinned size', async () => {
    const bigger = new Map(BODIES);
    bigger.set(FILES[2]!.url, new Uint8Array(TOKENS.byteLength + 10));

    const error = await ensureModelFiles({ files: FILES, dir, fetchImpl: serve(bigger).fetchImpl }).catch((e) => e);

    expect((error as ModelFetchError).code).toBe('TOO_LARGE');
  });

  it('stops every download when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = (async (_url: string, init?: { signal?: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        pull: () =>
          new Promise<void>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
              once: true,
            });
          }),
      });
      return new Response(body, { status: 200 });
    }) as unknown as FetchLike;

    const pending = ensureModelFiles({ files: FILES, dir, fetchImpl, signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e) => e);

    expect((error as ModelFetchError).code).toBe('ABORTED');
    expect(await modelFilesReady(FILES, dir)).toBe(false);
  });

  it('stops the other downloads as soon as one fails', async () => {
    const aborted: string[] = [];
    const fetchImpl = (async (url: string, init?: { signal?: AbortSignal }) => {
      if (url === FILES[2]!.url) return new Response(null, { status: 500 });
      const body = new ReadableStream<Uint8Array>({
        pull: () =>
          new Promise<void>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted.push(url);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          }),
      });
      return new Response(body, { status: 200 });
    }) as unknown as FetchLike;

    const error = await ensureModelFiles({ files: FILES, dir, fetchImpl }).catch((e) => e);

    expect((error as ModelFetchError).code).toBe('HTTP_ERROR');
    expect(aborted.sort()).toEqual([FILES[0]!.url, FILES[1]!.url].sort());
  });
});

describe('modelFilesReady', () => {
  it('is false before the download and true after it', async () => {
    expect(await modelFilesReady(FILES, dir)).toBe(false);
    await ensureModelFiles({ files: FILES, dir, fetchImpl: serve().fetchImpl });
    expect(await modelFilesReady(FILES, dir)).toBe(true);
  });

  it('is false when a file on disk has the wrong size', async () => {
    await ensureModelFiles({ files: FILES, dir, fetchImpl: serve().fetchImpl });
    await writeFile(path.join(dir, 'tokens.txt'), 'short');
    expect(await modelFilesReady(FILES, dir)).toBe(false);
  });
});
