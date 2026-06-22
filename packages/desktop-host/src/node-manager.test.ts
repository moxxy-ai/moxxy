import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { delimiter } from 'node:path';
import {
  MANAGED_NODE_VERSION,
  nodeArchive,
  managedNodeBinDir,
  activateManagedNode,
  isAllowedDownloadHost,
  psSingleQuote,
} from './node-manager';

describe('nodeArchive', () => {
  it('builds the macOS arm64 tar.gz url', () => {
    const a = nodeArchive('darwin', 'arm64');
    expect(a.dirName).toBe(`node-${MANAGED_NODE_VERSION}-darwin-arm64`);
    expect(a.fileName).toBe(`node-${MANAGED_NODE_VERSION}-darwin-arm64.tar.gz`);
    expect(a.url).toBe(
      `https://nodejs.org/dist/${MANAGED_NODE_VERSION}/node-${MANAGED_NODE_VERSION}-darwin-arm64.tar.gz`,
    );
    expect(a.shasumsUrl).toBe(
      `https://nodejs.org/dist/${MANAGED_NODE_VERSION}/SHASUMS256.txt`,
    );
  });

  it('uses tar.xz on Linux and zip on Windows', () => {
    expect(nodeArchive('linux', 'x64').fileName).toBe(
      `node-${MANAGED_NODE_VERSION}-linux-x64.tar.xz`,
    );
    expect(nodeArchive('win32', 'x64').fileName).toBe(
      `node-${MANAGED_NODE_VERSION}-win-x64.zip`,
    );
    expect(nodeArchive('win32', 'arm64').dirName).toBe(
      `node-${MANAGED_NODE_VERSION}-win-arm64`,
    );
  });

  it('throws a friendly error for unsupported arch / OS', () => {
    expect(() => nodeArchive('darwin', 'ia32')).toThrow(/nodejs\.org/);
    expect(() => nodeArchive('aix' as NodeJS.Platform, 'x64')).toThrow(/nodejs\.org/);
  });
});

describe('managedNodeBinDir / activateManagedNode', () => {
  const dirs: string[] = [];
  const origPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = origPath;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function makeManagedNode(platform: 'darwin' | 'win32'): { userData: string; binDir: string } {
    const userData = mkdtempSync(path.join(tmpdir(), 'moxxy-node-'));
    dirs.push(userData);
    const folder = path.join(
      userData,
      'node',
      `node-${MANAGED_NODE_VERSION}-${platform === 'win32' ? 'win' : 'darwin'}-arm64`,
    );
    const binDir = platform === 'win32' ? folder : path.join(folder, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, platform === 'win32' ? 'node.exe' : 'node'), '#!/bin/sh\n');
    return { userData, binDir };
  }

  it('returns null when no managed node is installed', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'moxxy-node-'));
    dirs.push(userData);
    expect(managedNodeBinDir(userData, 'darwin')).toBeNull();
  });

  it('finds the bin dir on POSIX and Windows layouts', () => {
    const mac = makeManagedNode('darwin');
    expect(managedNodeBinDir(mac.userData, 'darwin')).toBe(mac.binDir);
    const win = makeManagedNode('win32');
    expect(managedNodeBinDir(win.userData, 'win32')).toBe(win.binDir);
  });

  it('prefers the pinned version folder over an older node-v* folder', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'moxxy-node-'));
    dirs.push(userData);
    const root = path.join(userData, 'node');
    // An OLDER managed node (different version) alongside the pinned one. Both
    // contain a valid node binary, so selection must be by pin, not iteration
    // order / unstable sort.
    const olderBin = path.join(root, 'node-v20.0.0-darwin-arm64', 'bin');
    const pinnedBin = path.join(root, `node-${MANAGED_NODE_VERSION}-darwin-arm64`, 'bin');
    mkdirSync(olderBin, { recursive: true });
    writeFileSync(path.join(olderBin, 'node'), '#!/bin/sh\n');
    mkdirSync(pinnedBin, { recursive: true });
    writeFileSync(path.join(pinnedBin, 'node'), '#!/bin/sh\n');

    expect(managedNodeBinDir(userData, 'darwin')).toBe(pinnedBin);
  });

  it('falls back to a non-pinned node-v* folder when the pinned one is absent', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'moxxy-node-'));
    dirs.push(userData);
    const olderBin = path.join(userData, 'node', 'node-v20.0.0-darwin-arm64', 'bin');
    mkdirSync(olderBin, { recursive: true });
    writeFileSync(path.join(olderBin, 'node'), '#!/bin/sh\n');
    expect(managedNodeBinDir(userData, 'darwin')).toBe(olderBin);
  });

  it('prepends the bin dir to PATH idempotently', () => {
    const { userData, binDir } = makeManagedNode(process.platform === 'win32' ? 'win32' : 'darwin');
    const activated = activateManagedNode(userData);
    expect(activated).toBe(binDir);
    expect((process.env.PATH ?? '').split(delimiter)[0]).toBe(binDir);
    // Second call must not stack a duplicate.
    activateManagedNode(userData);
    const count = (process.env.PATH ?? '').split(delimiter).filter((p) => p === binDir).length;
    expect(count).toBe(1);
  });
});

describe('isAllowedDownloadHost — redirect host pinning', () => {
  it('permits nodejs.org and its subdomains only', () => {
    expect(isAllowedDownloadHost('nodejs.org')).toBe(true);
    expect(isAllowedDownloadHost('NODEJS.ORG')).toBe(true);
    expect(isAllowedDownloadHost('cdn.nodejs.org')).toBe(true);
  });

  it('rejects any off-host redirect target (would defeat the SHASUMS check)', () => {
    // An on-path attacker could redirect BOTH the archive and the checksum to a
    // matched (archive, checksum) pair on a host they control; pinning forbids it.
    expect(isAllowedDownloadHost('evil.example')).toBe(false);
    expect(isAllowedDownloadHost('nodejs.org.evil.example')).toBe(false);
    expect(isAllowedDownloadHost('notnodejs.org')).toBe(false);
    expect(isAllowedDownloadHost('127.0.0.1')).toBe(false);
    expect(isAllowedDownloadHost('')).toBe(false);
  });
});

describe('psSingleQuote — PowerShell single-quote escaping', () => {
  it('doubles embedded apostrophes so a path can never break out of the quote', () => {
    // A Windows account name with an apostrophe (O'Brien) would otherwise
    // terminate the single-quoted literal and inject arbitrary PowerShell.
    expect(psSingleQuote("C:\\Users\\O'Brien\\AppData\\node.zip")).toBe(
      "C:\\Users\\O''Brien\\AppData\\node.zip",
    );
    expect(psSingleQuote("'; Remove-Item C:\\ -Recurse; '")).toBe(
      "''; Remove-Item C:\\ -Recurse; ''",
    );
  });

  it('leaves an injection-free path untouched', () => {
    const p = 'C:\\Users\\alice\\AppData\\node-v22.zip';
    expect(psSingleQuote(p)).toBe(p);
  });
});
