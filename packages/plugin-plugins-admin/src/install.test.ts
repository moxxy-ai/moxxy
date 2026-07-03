import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCapabilityReport,
  buildInstallPluginTool,
  buildUninstallPluginTool,
  installPluginPackage,
  removePluginPackage,
  userPluginsDir,
} from './install.js';

const noopDeps = {
  reload: async (): Promise<void> => undefined,
  snapshot: () => ({
    tools: [],
    agents: [],
    providers: [],
    modes: [],
    compactors: [],
    channels: [],
  }),
};

describe('install_plugin tool', () => {

  it('validates package name format', async () => {
    const tool = buildInstallPluginTool(noopDeps);
    const result = tool.inputSchema.safeParse({ packageName: 'NOT VALID NAME' });
    expect(result.success).toBe(false);
  });

  it('accepts a scoped package', () => {
    const tool = buildInstallPluginTool(noopDeps);
    const result = tool.inputSchema.safeParse({ packageName: '@moxxy/agent-researcher' });
    expect(result.success).toBe(true);
  });

  it('accepts an optional version', () => {
    const tool = buildInstallPluginTool(noopDeps);
    const result = tool.inputSchema.safeParse({
      packageName: '@moxxy/agent-researcher',
      version: '1.2.3',
    });
    expect(result.success).toBe(true);
  });

  it('accepts common range / dist-tag version shapes', () => {
    const tool = buildInstallPluginTool(noopDeps);
    for (const version of ['latest', 'v1.2.3', '^1.0.0', '~2.3.4', '*', '2.x', '1.2.3-rc.1']) {
      expect(tool.inputSchema.safeParse({ packageName: 'left-pad', version }).success).toBe(true);
    }
  });

  // A flag-like version would otherwise produce a malformed `pkg@--evil` spec;
  // reject it at the schema with a clear message instead.
  it('rejects flag-like version values', () => {
    const tool = buildInstallPluginTool(noopDeps);
    for (const version of ['--evil', '-g', '-rc', '--registry=http://evil']) {
      expect(tool.inputSchema.safeParse({ packageName: 'left-pad', version }).success).toBe(false);
    }
  });
});

describe('buildCapabilityReport', () => {
  it('returns undefined when the install registered no tools', () => {
    expect(buildCapabilityReport([], () => undefined)).toBeUndefined();
  });

  it('unions declared specs and names the undeclared tools', () => {
    const report = buildCapabilityReport(['a', 'b', 'c'], (name) =>
      name === 'a'
        ? { capabilities: { net: { mode: 'allowlist', hosts: ['x.com'] }, subprocess: true } }
        : name === 'b'
          ? { capabilities: { net: { mode: 'any' }, timeMs: 60_000 } }
          : undefined,
    );
    expect(report).toEqual({
      declared: 2,
      total: 3,
      surface: { net: { mode: 'any' }, timeMs: 60_000, subprocess: true },
      undeclaredTools: ['c'],
    });
  });

  it('omits undeclaredTools when every tool declares', () => {
    const report = buildCapabilityReport(['a'], () => ({
      capabilities: { net: { mode: 'none' } },
    }));
    expect(report).toEqual({ declared: 1, total: 1, surface: { net: { mode: 'none' } } });
  });
});

describe('uninstall_plugin tool', () => {
  it('is named uninstall_plugin and gated', () => {
    const tool = buildUninstallPluginTool(noopDeps);
    expect(tool.name).toBe('uninstall_plugin');
    expect(tool.permission).toEqual({ action: 'prompt' });
  });

  it('validates package name format', () => {
    const tool = buildUninstallPluginTool(noopDeps);
    expect(tool.inputSchema.safeParse({ packageName: 'NOT VALID NAME' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ packageName: '@moxxy/agent-researcher' }).success).toBe(true);
  });
});

// A pre-aborted signal must short-circuit BEFORE npm is ever spawned: the abort
// guard at the top of runNpm rejects, so a turn aborted before the install
// starts never launches a child process and never blocks on the network. We
// redirect MOXXY_HOME to a temp dir so the install dir + package.json stub land
// there (never the user's real ~/.moxxy/plugins), and assert no node_modules is
// produced (npm never ran).
describe('installPluginPackage / removePluginPackage honor a pre-aborted signal', () => {
  let home: string;
  let prevHome: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'mox-plugins-home-'));
    prevHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('rejects an already-aborted install without spawning npm', async () => {
    const signal = AbortSignal.abort();
    await expect(installPluginPackage({ packageName: 'left-pad', signal })).rejects.toThrow(
      /aborted before start/,
    );
    // npm never ran: no node_modules was materialized in the plugins dir.
    expect(existsSync(path.join(userPluginsDir(), 'node_modules'))).toBe(false);
    // The dir contents are at most the auto-created package.json stub.
    const entries = existsSync(userPluginsDir()) ? readdirSync(userPluginsDir()) : [];
    expect(entries.every((e) => e === 'package.json')).toBe(true);
  });

  it('rejects an already-aborted uninstall without spawning npm', async () => {
    const signal = AbortSignal.abort();
    await expect(removePluginPackage({ packageName: 'left-pad', signal })).rejects.toThrow(
      /aborted before start/,
    );
    expect(existsSync(path.join(userPluginsDir(), 'node_modules'))).toBe(false);
  });
});
