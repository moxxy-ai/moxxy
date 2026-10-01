import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { helperDigest, helperProblem, validateHelperArtifact, verifyHelperArtifact, writeHelperManifest } from './artifact.js';

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
    expect(() => validateHelperArtifact(universal, { protocolVersion: 5, architecture: 'universal', sha256: helperDigest(universal) }, 5)).not.toThrow();
    const armOnly = fatMachO([ARM64]);
    expect(() => validateHelperArtifact(armOnly, { protocolVersion: 5, architecture: 'universal', sha256: helperDigest(armOnly) }, 5)).toThrow(/universal/);
  });

  it('accepts a thin Mach-O whose CPU matches the manifest', () => {
    const arm = thinMachO(ARM64);
    expect(() => validateHelperArtifact(arm, { protocolVersion: 5, architecture: 'arm64', sha256: helperDigest(arm) }, 5)).not.toThrow();
    expect(() => validateHelperArtifact(arm, { protocolVersion: 5, architecture: 'x86_64', sha256: helperDigest(arm) }, 5)).toThrow(/x86_64/);
  });

  it('never accepts a Windows executable for a macOS manifest or the reverse', () => {
    const arm = thinMachO(ARM64);
    expect(() => validateHelperArtifact(arm, { protocolVersion: 5, architecture: 'x64', sha256: digest(arm) }, 5)).toThrow();
  });
});

function elf(machine: number, bits: 1 | 2 = 2): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.write('\x7fELF', 0, 'latin1'); bytes[4] = bits; bytes[5] = 1; bytes.writeUInt16LE(machine, 18);
  return bytes;
}

describe('Linux helper artifact', () => {
  const linux = (bytes: Buffer, architecture: string) => ({ protocolVersion: 5, os: 'linux', architecture, sha256: digest(bytes) });

  it('accepts a 64-bit ELF whose machine matches the manifest', () => {
    const x64 = elf(62);
    const arm = elf(183);
    expect(() => validateHelperArtifact(x64, linux(x64, 'x64'), 5)).not.toThrow();
    expect(() => validateHelperArtifact(arm, linux(arm, 'arm64'), 5)).not.toThrow();
    expect(() => validateHelperArtifact(arm, linux(arm, 'x64'), 5)).toThrow(/Linux x64/);
    expect(() => validateHelperArtifact(elf(62, 1), linux(elf(62, 1), 'x64'), 5)).toThrow(/Linux x64/);
    expect(() => validateHelperArtifact(x64, { ...linux(x64, 'x64'), sha256: '0'.repeat(64) }, 5)).toThrow(/checksum/);
  });

  it('never takes an ELF for Windows or macOS, or another format for Linux', () => {
    const x64 = elf(62);
    expect(() => validateHelperArtifact(x64, { protocolVersion: 5, architecture: 'x64', sha256: digest(x64) }, 5)).toThrow();
    expect(() => validateHelperArtifact(x64, { protocolVersion: 5, architecture: 'arm64', sha256: digest(x64) }, 5)).toThrow();
    const arm = thinMachO(ARM64);
    expect(() => validateHelperArtifact(arm, linux(arm, 'arm64'), 5)).toThrow(/Linux arm64/);
    expect(() => validateHelperArtifact(x64, linux(x64, 'universal'), 5)).toThrow();
  });
});

describe('helper artifact on disk', () => {
  const directories: string[] = [];
  const directory = () => { const made = mkdtempSync(join(tmpdir(), 'moxxy-artifact-')); directories.push(made); return made; };
  afterEach(() => { for (const made of directories.splice(0)) rmSync(made, { recursive: true, force: true }); });

  it('writes a manifest the verifier accepts, and reports a missing or mismatched helper before launch', async () => {
    const helper = join(directory(), 'moxxy-computer');
    expect(helperProblem(helper, 5)).toMatch(/missing/);
    writeFileSync(helper, thinMachO(ARM64));
    expect(helperProblem(helper, 5)).toMatch(/manifest/);
    await writeHelperManifest(helper, { protocolVersion: 5, architecture: 'arm64' });
    await expect(verifyHelperArtifact(helper, 5)).resolves.toBeUndefined();
    expect(helperProblem(helper, 5)).toBeUndefined();
    expect(helperProblem(helper, 6)).toMatch(/protocol 5.*needs 6/);
  });

  // Packaging signs every executable in the app again, after the manifest was written.
  it.skipIf(process.platform !== 'darwin')('keeps the digest of a Mach-O that is signed again, and changes it when the code changes', () => {
    const helper = join(directory(), 'helper');
    copyFileSync('/usr/bin/true', helper);
    const sign = (...args: string[]) => execFileSync('codesign', ['--force', '--sign', '-', ...args, helper], { stdio: 'ignore' });
    sign('--identifier', 'a');
    const first = readFileSync(helper);
    sign('--identifier', 'ai.moxxy.a-much-longer-identifier-than-before.helper', '--options', 'runtime');
    const second = readFileSync(helper);
    expect(digest(second)).not.toBe(digest(first));
    expect(helperDigest(second)).toBe(helperDigest(first));
    const patched = Buffer.from(second);
    const code = (patched.readUInt32BE(0) === 0xcafebabe ? patched.readUInt32BE(16) : 0) + 4096;
    patched.writeUInt8(patched.readUInt8(code) ^ 0xff, code);
    expect(helperDigest(patched)).not.toBe(helperDigest(second));
  });

  it('rejects a Mach-O whose slices or load commands point outside the file', () => {
    const fat = fatMachO([ARM64]);
    fat.writeUInt32BE(4096, 16); fat.writeUInt32BE(4096, 20);
    expect(() => helperDigest(fat)).toThrow(/Invalid Computer Use executable/);
    const thin = thinMachO(ARM64);
    thin.writeUInt32LE(3, 16); thin.writeUInt32LE(4096, 20);
    expect(() => helperDigest(thin)).toThrow(/Invalid Computer Use executable/);
  });
});
