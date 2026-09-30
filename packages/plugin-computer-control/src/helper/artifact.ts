import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { z } from 'zod';

const manifestSchema = (protocolVersion: number) => z.object({
  protocolVersion: z.literal(protocolVersion),
  architecture: z.enum(['x64', 'arm64', 'x86_64', 'universal']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Architecture = z.infer<ReturnType<typeof manifestSchema>>['architecture'];

const MACH_O_64 = 0xfeedfacf;
const MACH_O_FAT = 0xcafebabe;
const CPU = { arm64: 0x0100000c, x86_64: 0x01000007 } as const;

function assertWindowsX64(bytes: Buffer): void {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid Computer Use executable');
  const offset = bytes.readUInt32LE(60);
  if (offset > bytes.length - 6 || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' || bytes.readUInt16LE(offset + 4) !== 0x8664) {
    throw new Error('Computer Use requires a Windows x64 executable');
  }
}

/** CPU types carried by a thin or fat Mach-O; empty when the bytes are not Mach-O. */
function machOCpus(bytes: Buffer): number[] {
  if (bytes.length < 8) return [];
  if (bytes.readUInt32LE(0) === MACH_O_64) return [bytes.readUInt32LE(4)];
  if (bytes.readUInt32BE(0) !== MACH_O_FAT) return [];
  const count = bytes.readUInt32BE(4);
  if (count > 16 || 8 + count * 20 > bytes.length) return [];
  return Array.from({ length: count }, (_, index) => bytes.readUInt32BE(8 + index * 20));
}

function assertMacOS(bytes: Buffer, architecture: Exclude<Architecture, 'x64'>): void {
  const cpus = machOCpus(bytes);
  const required = architecture === 'universal' ? [CPU.arm64, CPU.x86_64] : [CPU[architecture]];
  if (!required.every((cpu) => cpus.includes(cpu))) throw new Error(`Computer Use requires a macOS ${architecture} executable`);
}

export function validateHelperArtifact(bytes: Buffer, manifest: unknown, protocolVersion: number): void {
  const expected = manifestSchema(protocolVersion).parse(manifest);
  if (expected.architecture === 'x64') assertWindowsX64(bytes);
  else assertMacOS(bytes, expected.architecture);
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

export async function verifyHelperArtifact(executable: string, protocolVersion: number): Promise<void> {
  const manifestPath = executable + '.json';
  const [bytes, manifest] = await Promise.all([
    readBounded(executable, 32_000_000),
    readBounded(manifestPath, 4096),
  ]);
  validateHelperArtifact(bytes, JSON.parse(manifest.toString('utf8')), protocolVersion);
}
