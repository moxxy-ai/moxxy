/**
 * Downloads a release file to disk and keeps it only when it is the file the
 * release named. Streamed: the installer is over a gigabyte, and holding it in
 * memory is what used to crash the update on macOS.
 */

import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

import { fetchAllowed } from '../app-update/stager.js';

/** A connection that sends nothing for this long is taken as lost. */
const STALLED_MS = 60_000;

export interface DownloadOptions {
  readonly url: string;
  readonly dest: string;
  /** SHA-512 the file must have, base64. */
  readonly sha512: string;
  /** Size the release gave; a longer file is cut off there. */
  readonly size: number;
  readonly onProgress?: (received: number, total: number) => void;
}

async function sha512Of(file: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}

async function isWhole(file: string, opts: DownloadOptions): Promise<boolean> {
  try {
    if ((await fs.stat(file)).size !== opts.size) return false;
    return (await sha512Of(file)) === opts.sha512;
  } catch {
    return false;
  }
}

/** The next piece of the body, or a rejection when none comes in time. */
function within<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The download stopped.')), ms);
  });
  return Promise.race([read, stalled]).finally(() => clearTimeout(timer));
}

export async function downloadVerified(opts: DownloadOptions, deps: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  const { url, dest, size } = opts;
  const report = opts.onProgress ?? (() => {});
  if (await isWhole(dest, opts)) {
    report(size, size);
    return;
  }

  const res = await fetchAllowed(deps.fetchImpl ?? fetch, url);
  if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);

  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const hash = createHash('sha512');
  const reader = res.body.getReader();
  const file = await fs.open(part, 'w');
  try {
    let received = 0;
    for (;;) {
      // What the network layer calls it ("terminated") tells nobody anything.
      const read = reader.read().catch(() => {
        throw new Error('The download was interrupted. Check the connection and try again.');
      });
      const { done, value } = await within(read, STALLED_MS);
      if (done) break;
      received += value.length;
      if (received > size) throw new Error('The download is larger than the release said.');
      hash.update(value);
      await file.write(value);
      report(received, size);
    }
    await file.close();
    if (hash.digest('base64') !== opts.sha512) throw new Error('The download does not match the release.');
    await fs.rename(part, dest);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await file.close().catch(() => undefined);
    await fs.rm(part, { force: true });
    await fs.rm(dest, { force: true });
    throw error;
  }
}
