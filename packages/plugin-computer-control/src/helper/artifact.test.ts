import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateHelperArtifact } from './artifact.js';

// Synthetic file headers test the parser, not native execution.
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;

function thinMachO(cpu: number): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(cpu, 4);
  return bytes;
}

function fatMachO(cpus: number[]): Buffer {
  const bytes = Buffer.alloc(8 + cpus.length * 20 + 16);
  bytes.writeUInt32BE(0xcafebabe, 0); bytes.writeUInt32BE(cpus.length, 4);
  cpus.forEach((cpu, index) => bytes.writeUInt32BE(cpu, 8 + index * 20));
  return bytes;
}

describe('helper artifact validation', () => {
  it('validates PE architecture, protocol and exact executable digest before launch', () => {
    const bytes = Buffer.alloc(256);
    bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
    const manifest = { protocolVersion: 4, architecture: 'x64', sha256: digest(bytes) };
    expect(() => validateHelperArtifact(bytes, manifest, 4)).not.toThrow();
    expect(() => validateHelperArtifact(bytes, { ...manifest, protocolVersion: 1 }, 4)).toThrow();
    expect(() => validateHelperArtifact(bytes, manifest, 5)).toThrow();
    expect(() => validateHelperArtifact(bytes, { ...manifest, sha256: '0'.repeat(64) }, 4)).toThrow();
    bytes.writeUInt16LE(0xAA64, 132);
    expect(() => validateHelperArtifact(bytes, { ...manifest, sha256: digest(bytes) }, 4)).toThrow(/x64/);
    expect(() => validateHelperArtifact(Buffer.alloc(2), manifest, 4)).toThrow();
  });

  it('accepts a universal Mach-O only when it carries both arm64 and x86_64 slices', () => {
    const universal = fatMachO([X86_64, ARM64]);
    expect(() => validateHelperArtifact(universal, { protocolVersion: 5, architecture: 'universal', sha256: digest(universal) }, 5)).not.toThrow();
    const armOnly = fatMachO([ARM64]);
    expect(() => validateHelperArtifact(armOnly, { protocolVersion: 5, architecture: 'universal', sha256: digest(armOnly) }, 5)).toThrow(/universal/);
  });

  it('accepts a thin Mach-O whose CPU matches the manifest', () => {
    const arm = thinMachO(ARM64);
    expect(() => validateHelperArtifact(arm, { protocolVersion: 5, architecture: 'arm64', sha256: digest(arm) }, 5)).not.toThrow();
    expect(() => validateHelperArtifact(arm, { protocolVersion: 5, architecture: 'x86_64', sha256: digest(arm) }, 5)).toThrow(/x86_64/);
  });

  it('never accepts a Windows executable for a macOS manifest or the reverse', () => {
    const arm = thinMachO(ARM64);
    expect(() => validateHelperArtifact(arm, { protocolVersion: 5, architecture: 'x64', sha256: digest(arm) }, 5)).toThrow();
  });
});
