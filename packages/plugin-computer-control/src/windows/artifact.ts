import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { z } from 'zod';
import { PROTOCOL_VERSION } from './contracts.js';

const manifestSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), architecture: z.literal('x64'), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export function validateHelperArtifact(bytes: Buffer, manifest: unknown): void {
  const expected = manifestSchema.parse(manifest);
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid Computer Use executable');
  const offset = bytes.readUInt32LE(60);
  if (offset > bytes.length - 6 || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' || bytes.readUInt16LE(offset + 4) !== 0x8664) {
    throw new Error('Computer Use requires a Windows x64 executable');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('Computer Use executable checksum mismatch');
}

// POSIX-only; Node leaves it undefined on Windows.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Read a regular file no larger than `limit`, checking the open handle rather
 * than the path so the bytes that are validated are the bytes that were
 * measured. A `stat` followed by `readFile` can be repointed in between, which
 * would let an oversized file through the size guard.
 */
async function readBounded(file: string, limit: number): Promise<Buffer> {
  if (O_NOFOLLOW === 0 && (await lstat(file)).isSymbolicLink()) {
    throw new Error('Computer Use artifact exceeds size limit');
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(file, constants.O_RDONLY | O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('Computer Use artifact exceeds size limit');
    return await handle.readFile();
  } catch (error) {
    // O_NOFOLLOW reports a symlink as ELOOP.
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('Computer Use artifact exceeds size limit');
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function verifyHelperArtifact(executable: string): Promise<void> {
  const manifestPath = executable + '.json';
  const [bytes, manifest] = await Promise.all([
    readBounded(executable, 32_000_000),
    readBounded(manifestPath, 4096),
  ]);
  validateHelperArtifact(bytes, JSON.parse(manifest.toString('utf8')));
}
