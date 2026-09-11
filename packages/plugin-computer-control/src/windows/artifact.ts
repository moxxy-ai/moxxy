import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
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

export async function verifyHelperArtifact(executable: string): Promise<void> {
  const manifestPath = executable + '.json';
  const [binaryInfo, manifestInfo] = await Promise.all([stat(executable), stat(manifestPath)]);
  if (binaryInfo.size > 32_000_000 || manifestInfo.size > 4096) throw new Error('Computer Use artifact exceeds size limit');
  const [bytes, manifest] = await Promise.all([readFile(executable), readFile(manifestPath, 'utf8')]);
  validateHelperArtifact(bytes, JSON.parse(manifest));
}
