import { createHash } from 'node:crypto';
import { constants, existsSync, readFileSync } from 'node:fs';
import { lstat, open, rename, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { z } from 'zod';

const manifestSchema = (protocolVersion: number) => z.object({
  protocolVersion: z.literal(protocolVersion),
  /** Absent for Windows and macOS, which the architecture alone tells apart. */
  os: z.literal('linux').optional(),
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

const ELF_MACHINE: Partial<Record<Architecture, number>> = { x64: 62, arm64: 183 };

function assertLinux(bytes: Buffer, architecture: Architecture): void {
  const machine = ELF_MACHINE[architecture];
  // 64-bit, little-endian ELF for the named machine.
  const matches = machine !== undefined && bytes.length >= 20 && bytes.toString('latin1', 0, 4) === '\x7fELF'
    && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === machine;
  if (!matches) throw new Error(`Computer Use requires a Linux ${architecture} executable`);
}

function assertMacOS(bytes: Buffer, architecture: Exclude<Architecture, 'x64'>): void {
  const cpus = (machOSlices(bytes) ?? []).map(({ cpu }) => cpu);
  const required = architecture === 'universal' ? [CPU.arm64, CPU.x86_64] : [CPU[architecture]];
  if (!required.every((cpu) => cpus.includes(cpu))) throw new Error(`Computer Use requires a macOS ${architecture} executable`);
}

const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const invalid = () => new Error('Invalid Computer Use executable');

/** One Mach-O slice without its code signature, with the fields signing rewrites set to zero. */
function unsignedSlice(slice: Buffer): Buffer {
  if (slice.length < 32 || slice.readUInt32LE(0) !== MACH_O_64) throw invalid();
  const copy = Buffer.from(slice);
  const commands = copy.readUInt32LE(16);
  if (32 + copy.readUInt32LE(20) > copy.length) throw invalid();
  let end = copy.length;
  let offset = 32;
  for (let index = 0; index < commands; index++) {
    if (offset + 8 > copy.length) throw invalid();
    const command = copy.readUInt32LE(offset);
    const size = copy.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > copy.length) throw invalid();
    if (command === LC_CODE_SIGNATURE && size >= 16) {
      end = Math.min(end, copy.readUInt32LE(offset + 8));
      copy.fill(0, offset + 8, offset + 16);
    } else if (command === LC_SEGMENT_64 && size >= 72 && copy.toString('latin1', offset + 8, offset + 24).replace(/\0+$/, '') === '__LINKEDIT') {
      // The signature is the tail of __LINKEDIT, so its sizes move with it.
      copy.fill(0, offset + 32, offset + 40);
      copy.fill(0, offset + 48, offset + 56);
    }
    offset += size;
  }
  return copy.subarray(0, end);
}

/** The slices of a thin or fat Mach-O with their CPU type; `undefined` when the bytes are not Mach-O. */
function machOSlices(bytes: Buffer): Array<{ cpu: number; slice: Buffer }> | undefined {
  if (bytes.length < 8) return undefined;
  if (bytes.readUInt32LE(0) === MACH_O_64) return [{ cpu: bytes.readUInt32LE(4), slice: bytes }];
  if (bytes.readUInt32BE(0) !== MACH_O_FAT) return undefined;
  const count = bytes.readUInt32BE(4);
  if (count > 16 || 8 + count * 20 > bytes.length) throw invalid();
  return Array.from({ length: count }, (_, index) => {
    const entry = 8 + index * 20;
    const start = bytes.readUInt32BE(entry + 8);
    const size = bytes.readUInt32BE(entry + 12);
    if (start + size > bytes.length) throw invalid();
    return { cpu: bytes.readUInt32BE(entry), slice: bytes.subarray(start, start + size) };
  });
}

/**
 * The digest a manifest records. A Windows or Linux executable is hashed whole. A Mach-O
 * is hashed without its code signatures, because packaging the desktop app signs
 * every executable again after the manifest was written; macOS itself refuses to
 * run code whose signature does not match.
 */
export function helperDigest(bytes: Buffer): string {
  const hash = createHash('sha256');
  const slices = machOSlices(bytes);
  if (!slices) return hash.update(bytes).digest('hex');
  for (const { cpu, slice } of slices) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(cpu);
    // An empty fat entry (synthetic headers in tests) has no code to hash.
    hash.update(header).update(slice.length === 0 ? slice : unsignedSlice(slice));
  }
  return hash.digest('hex');
}

export function validateHelperArtifact(bytes: Buffer, manifest: unknown, protocolVersion: number): void {
  const expected = manifestSchema(protocolVersion).parse(manifest);
  if (expected.os === 'linux') assertLinux(bytes, expected.architecture);
  else if (expected.architecture === 'x64') assertWindowsX64(bytes);
  else assertMacOS(bytes, expected.architecture);
  if (helperDigest(bytes) !== expected.sha256) throw new Error('Computer Use executable checksum mismatch');
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

/** Written by the native build next to the executable it just produced. */
export async function writeHelperManifest(executable: string, manifest: { protocolVersion: number; architecture: Architecture; os?: 'linux' }): Promise<void> {
  const sha256 = helperDigest(await readBounded(executable, 32_000_000));
  const temporary = `${executable}.json.tmp`;
  await writeFile(temporary, JSON.stringify({ ...manifest, sha256 }));
  await rename(temporary, `${executable}.json`);
}

/**
 * Why a helper cannot be used, known without reading the executable: decides
 * which tools a plugin offers. The full check runs before every launch.
 */
export function helperProblem(executable: string, protocolVersion: number): string | undefined {
  if (!existsSync(executable)) return 'The Computer Use helper is missing.';
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(`${executable}.json`, 'utf8'));
  } catch {
    return 'The Computer Use helper has no readable manifest.';
  }
  const found = z.object({ protocolVersion: z.number().int() }).safeParse(manifest);
  if (!found.success) return 'The Computer Use helper has no readable manifest.';
  if (found.data.protocolVersion !== protocolVersion) {
    return `The Computer Use helper speaks protocol ${found.data.protocolVersion}; this version needs ${protocolVersion}.`;
  }
  return undefined;
}
