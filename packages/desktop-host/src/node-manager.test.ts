import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { delimiter } from 'node:path';
import {
  MANAGED_NODE_VERSION,
  nodeArchive,
  managedNodeBinDir,
  activateManagedNode,
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
