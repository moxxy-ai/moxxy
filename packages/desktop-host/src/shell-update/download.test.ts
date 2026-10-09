import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { downloadVerified } from './download';

const URL_OK = 'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v9.9.9/app.zip';
const BODY = Buffer.from('a'.repeat(70_000) + 'b'.repeat(70_000));
const sha512 = (bytes: Buffer): string => createHash('sha512').update(bytes).digest('base64');

/** The network is the one thing outside this machine: a `fetch` that answers
 *  with a real streamed `Response`, and counts how often it was asked. */
function serving(body: Buffer, options: { breakAfter?: number; status?: number } = {}): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    const chunks = [body.subarray(0, 50_000), body.subarray(50_000, 100_000), body.subarray(100_000)];
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (options.breakAfter !== undefined && sent >= options.breakAfter) {
          controller.error(new Error('connection reset'));
          return;
        }
        const chunk = chunks[sent];
        sent += 1;
        if (chunk && chunk.length > 0) controller.enqueue(chunk);
        else controller.close();
      },
    });
    return new Response(stream, { status: options.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

let dir: string;
let dest: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'shell-download-'));
  dest = path.join(dir, 'downloads', 'app.zip');
});

describe('downloadVerified', () => {
  it('writes the file to disk and says how far it is', async () => {
    const seen: Array<[number, number]> = [];
    const { fetchImpl } = serving(BODY);

    await downloadVerified(
      { url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length, onProgress: (received, total) => seen.push([received, total]) },
      { fetchImpl },
    );

    expect(readFileSync(dest).equals(BODY)).toBe(true);
    expect(seen.at(-1)).toEqual([BODY.length, BODY.length]);
    expect(seen.length).toBeGreaterThan(1);
  });

  it('keeps nothing when the bytes are not the ones the release named', async () => {
    const { fetchImpl } = serving(BODY);

    await expect(
      downloadVerified({ url: URL_OK, dest, sha512: sha512(Buffer.from('something else')), size: BODY.length }, { fetchImpl }),
    ).rejects.toThrow(/does not match/);

    expect(readdirSync(path.dirname(dest))).toEqual([]);
  });

  it('keeps nothing when the connection breaks half way', async () => {
    const { fetchImpl } = serving(BODY, { breakAfter: 1 });

    await expect(
      downloadVerified({ url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length }, { fetchImpl }),
    ).rejects.toThrow(/connection reset/);

    expect(readdirSync(path.dirname(dest))).toEqual([]);
  });

  it('stops at a file longer than the release said', async () => {
    const { fetchImpl } = serving(BODY);

    await expect(
      downloadVerified({ url: URL_OK, dest, sha512: sha512(BODY), size: 60_000 }, { fetchImpl }),
    ).rejects.toThrow(/larger than/);

    expect(existsSync(dest)).toBe(false);
  });

  it('says so when the server refuses', async () => {
    const { fetchImpl } = serving(BODY, { status: 404 });

    await expect(
      downloadVerified({ url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length }, { fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('does not download again a file that is already there and whole', async () => {
    const first = serving(BODY);
    await downloadVerified({ url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length }, { fetchImpl: first.fetchImpl });
    const second = serving(BODY);
    const seen: Array<[number, number]> = [];

    await downloadVerified(
      { url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length, onProgress: (received, total) => seen.push([received, total]) },
      { fetchImpl: second.fetchImpl },
    );

    expect(second.calls()).toBe(0);
    expect(seen).toEqual([[BODY.length, BODY.length]]);
  });

  it('downloads again over a file that is there but damaged', async () => {
    const { fetchImpl, calls } = serving(BODY);
    await downloadVerified({ url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length }, { fetchImpl });
    writeFileSync(dest, 'damaged');

    await downloadVerified({ url: URL_OK, dest, sha512: sha512(BODY), size: BODY.length }, { fetchImpl });

    expect(calls()).toBe(2);
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it('asks no host but the release one', async () => {
    const { fetchImpl, calls } = serving(BODY);

    await expect(
      downloadVerified({ url: 'https://elsewhere.example/app.zip', dest, sha512: sha512(BODY), size: BODY.length }, { fetchImpl }),
    ).rejects.toThrow(/allowed origin/);

    expect(calls()).toBe(0);
  });
});
