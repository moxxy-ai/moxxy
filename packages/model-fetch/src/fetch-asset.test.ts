import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelFetchError } from './errors.js';
import {
  DEFAULT_ALLOWED_HOSTS,
  fetchModelAsset,
  isAllowedAssetUrl,
  type FetchLike,
} from './fetch-asset.js';

const HOST_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/asset.bin';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A `fetch` returning fixed bytes with a matching Content-Length header. */
function okFetch(bytes: Uint8Array, headers: Record<string, string> = {}): {
  fetchImpl: FetchLike;
  calls: number;
} {
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls += 1;
    return new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength), ...headers },
    });
  }) as unknown as FetchLike;
  return { fetchImpl, get calls() {
    return state.calls;
  } };
}

/** A `fetch` whose body streams one chunk, then stalls until `signal` aborts. */
function stallingFetch(firstChunk: Uint8Array): FetchLike {
  return (async (_url: string, init?: { signal?: AbortSignal }) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstChunk);
      },
      pull(controller) {
        return new Promise<void>((_resolve, reject) => {
          const fail = (): void => {
            controller.error(new DOMException('Aborted', 'AbortError'));
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (signal?.aborted) fail();
          else signal?.addEventListener('abort', fail, { once: true });
        });
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as FetchLike;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'model-fetch-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('isAllowedAssetUrl', () => {
  it('admits https on allow-listed hosts and their subdomains', () => {
    expect(isAllowedAssetUrl('https://github.com/x')).toBe(true);
    expect(isAllowedAssetUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowedAssetUrl('https://huggingface.co/x')).toBe(true);
    expect(isAllowedAssetUrl('https://cdn-lfs.huggingface.co/x')).toBe(true);
  });
  it('refuses http, other schemes, and look-alike hosts', () => {
    expect(isAllowedAssetUrl('http://github.com/x')).toBe(false);
    expect(isAllowedAssetUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedAssetUrl('https://github.com.evil.com/x')).toBe(false);
    expect(isAllowedAssetUrl('https://raw.githubusercontent.com/x')).toBe(false);
    expect(isAllowedAssetUrl('not a url')).toBe(false);
  });
  it('honors a custom allow-list', () => {
    expect(isAllowedAssetUrl('https://example.com/x', ['example.com'])).toBe(true);
    expect(isAllowedAssetUrl('https://github.com/x', ['example.com'])).toBe(false);
  });
});

describe('fetchModelAsset', () => {
  it('downloads, verifies, publishes atomically and records a .ok marker', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const { fetchImpl } = okFetch(bytes);
    const phases: string[] = [];
    const res = await fetchModelAsset({
      url: HOST_URL,
      sha256: sha256(bytes),
      destDir: dir,
      fetchImpl,
      onProgress: (p) => phases.push(p.phase),
    });
    expect(res.skipped).toBe(false);
    expect(res.bytes).toBe(8);
    expect(new Uint8Array(await readFile(res.path))).toEqual(bytes);
    expect(await readFile(`${res.path}.ok`, 'utf8')).toBe(`${sha256(bytes)}\n`);
    expect(phases.at(-1)).toBe('done');
    expect(phases).toContain('verifying');
  });

  it('rejects a hash mismatch and cleans up the partial (no dest, no partial)', async () => {
    const bytes = new Uint8Array([9, 9, 9, 9]);
    const { fetchImpl } = okFetch(bytes);
    const wrong = 'f'.repeat(64);
    await expect(
      fetchModelAsset({ url: HOST_URL, sha256: wrong, destDir: dir, fetchImpl }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    const abs = path.join(dir, 'asset.bin');
    await expect(stat(abs)).rejects.toThrow();
    await expect(stat(`${abs}.partial`)).rejects.toThrow();
  });

  it('is idempotent: a second call with a matching marker skips the network', async () => {
    const bytes = new Uint8Array([4, 4, 4, 4]);
    const hash = sha256(bytes);
    const first = okFetch(bytes);
    await fetchModelAsset({ url: HOST_URL, sha256: hash, destDir: dir, fetchImpl: first.fetchImpl });
    expect(first.calls).toBe(1);

    const explode = (async () => {
      throw new Error('network must not be touched on a cache hit');
    }) as unknown as FetchLike;
    const res = await fetchModelAsset({ url: HOST_URL, sha256: hash, destDir: dir, fetchImpl: explode });
    expect(res.skipped).toBe(true);
  });

  it('refuses a url that is not on an allowed host (before any fetch)', async () => {
    let touched = false;
    const spy = (async () => {
      touched = true;
      return new Response(new Uint8Array());
    }) as unknown as FetchLike;
    await expect(
      fetchModelAsset({ url: 'https://evil.example/x.bin', sha256: 'a'.repeat(64), destDir: dir, fetchImpl: spy }),
    ).rejects.toMatchObject({ code: 'HOST_DENIED' });
    expect(touched).toBe(false);
  });

  it('rejects an over-cap download up front via Content-Length', async () => {
    const bytes = new Uint8Array(100);
    const { fetchImpl } = okFetch(bytes);
    await expect(
      fetchModelAsset({ url: HOST_URL, sha256: sha256(bytes), destDir: dir, fetchImpl, maxBytes: 10 }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('rejects an over-cap streamed body (no Content-Length) mid-stream', async () => {
    const bytes = new Uint8Array(50);
    // No content-length header ⇒ the up-front check is skipped; the streaming
    // guard must still fire.
    const fetchImpl = (async () => new Response(new Blob([bytes]).stream(), { status: 200 })) as unknown as FetchLike;
    await expect(
      fetchModelAsset({ url: HOST_URL, sha256: sha256(bytes), destDir: dir, fetchImpl, maxBytes: 10 }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('aborts mid-download and leaves no partial behind', async () => {
    const controller = new AbortController();
    const fetchImpl = stallingFetch(new Uint8Array([1, 2, 3, 4]));
    const p = fetchModelAsset({
      url: HOST_URL,
      sha256: 'a'.repeat(64),
      destDir: dir,
      fetchImpl,
      signal: controller.signal,
    });
    // Let the first chunk land, then abort while the body stalls.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort(new Error('user cancelled'));
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(stat(`${path.join(dir, 'asset.bin')}.partial`)).rejects.toThrow();
  });

  it('rejects a malformed sha256 pin', async () => {
    const { fetchImpl } = okFetch(new Uint8Array([1]));
    await expect(
      fetchModelAsset({ url: HOST_URL, sha256: 'nothex', destDir: dir, fetchImpl }),
    ).rejects.toBeInstanceOf(ModelFetchError);
  });

  it('surfaces a non-2xx response as HTTP_ERROR', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as FetchLike;
    await expect(
      fetchModelAsset({ url: HOST_URL, sha256: 'a'.repeat(64), destDir: dir, fetchImpl }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR' });
  });

  it('exposes the default allow-list', () => {
    expect(DEFAULT_ALLOWED_HOSTS).toContain('github.com');
    expect(DEFAULT_ALLOWED_HOSTS).toContain('huggingface.co');
  });

  it('derives the file name from the url when unspecified', async () => {
    const bytes = new Uint8Array([7]);
    const { fetchImpl } = okFetch(bytes);
    const res = await fetchModelAsset({ url: HOST_URL, sha256: sha256(bytes), destDir: dir, fetchImpl });
    expect(path.basename(res.path)).toBe('asset.bin');
  });

  it('honors an explicit fileName', async () => {
    const bytes = new Uint8Array([7]);
    const { fetchImpl } = okFetch(bytes);
    const res = await fetchModelAsset({
      url: HOST_URL,
      sha256: sha256(bytes),
      destDir: dir,
      fileName: 'voice.tar.bz2',
      fetchImpl,
    });
    expect(path.basename(res.path)).toBe('voice.tar.bz2');
    await writeFile(res.path, await readFile(res.path)); // sanity: file readable
  });
});
