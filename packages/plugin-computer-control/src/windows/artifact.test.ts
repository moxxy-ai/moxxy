import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { validateHelperArtifact } from './artifact.js';

it('validates PE architecture, protocol and exact executable digest before launch', () => {
  // Synthetic file header tests the parser, not native execution.
  const bytes = Buffer.alloc(256);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  const manifest = { protocolVersion: 3, architecture: 'x64', sha256: createHash('sha256').update(bytes).digest('hex') };
  expect(() => validateHelperArtifact(bytes, manifest)).not.toThrow();
  expect(() => validateHelperArtifact(bytes, { ...manifest, protocolVersion: 1 })).toThrow();
  expect(() => validateHelperArtifact(bytes, { ...manifest, sha256: '0'.repeat(64) })).toThrow();
  bytes.writeUInt16LE(0xAA64, 132);
  expect(() => validateHelperArtifact(bytes, { ...manifest, sha256: createHash('sha256').update(bytes).digest('hex') })).toThrow(/x64/);
  expect(() => validateHelperArtifact(Buffer.alloc(2), manifest)).toThrow();
});
