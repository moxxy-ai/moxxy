import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDef } from '@moxxy/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformProfile } from './backend/backend.js';
import { computerTools } from './contract/tools.js';
import { createComputerControlPlugin } from './index.js';
import { macosProfile } from './macos/profile.js';

const directories: string[] = [];
afterEach(() => { for (const made of directories.splice(0)) rmSync(made, { recursive: true, force: true }); });

/** A macOS profile whose helper files exist (or not) in a scratch directory; the helper is never started. */
function profile(manifest?: Record<string, unknown>): PlatformProfile {
  const directory = mkdtempSync(join(tmpdir(), 'moxxy-computer-index-'));
  directories.push(directory);
  const helperPath = join(directory, 'moxxy-computer');
  if (manifest) {
    writeFileSync(helperPath, 'binary');
    writeFileSync(`${helperPath}.json`, JSON.stringify(manifest));
  }
  return { ...macosProfile, helperPath };
}
const names = (tools: ReadonlyArray<ToolDef> | undefined) => (tools ?? []).map((tool) => tool.name).sort();
const ready = { protocolVersion: macosProfile.protocolVersion, architecture: 'universal', sha256: '0'.repeat(64) };
const context = { signal: new AbortController().signal } as never;

describe('createComputerControlPlugin', () => {
  it('runs macOS on the native helper with the shared tool set and human controls', () => {
    const plugin = createComputerControlPlugin('darwin', 'arm64', profile(ready));
    expect(names(plugin.tools)).toEqual(Object.keys(computerTools).sort());
    expect(names(plugin.tools)).not.toContain('computer_applescript');
    expect(plugin.hooks?.onInit).toBeTypeOf('function');
    expect(plugin.hooks?.onTurnEnd).toBeTypeOf('function');
    expect(plugin.hooks?.onBeforeProviderCall).toBeTypeOf('function');
    expect(plugin.surfaces?.map((surface) => surface.kind)).toEqual(['computer-preview']);
  });

  it('offers only computer_status, with the reason, when the macOS helper is missing', async () => {
    const plugin = createComputerControlPlugin('darwin', 'arm64', profile());
    expect(names(plugin.tools)).toEqual(['computer_status']);
    expect(plugin.hooks).toBeUndefined();
    const [status] = plugin.tools ?? [];
    expect(await status?.handler({}, context)).toEqual({
      platform: 'darwin', architecture: 'arm64', ready: false,
      limitations: [expect.stringMatching(/helper is missing/)],
    });
  });

  it('offers only computer_status when the helper speaks another protocol', async () => {
    const plugin = createComputerControlPlugin('darwin', 'arm64', profile({ ...ready, protocolVersion: macosProfile.protocolVersion - 1 }));
    expect(names(plugin.tools)).toEqual(['computer_status']);
    const [status] = plugin.tools ?? [];
    expect(await status?.handler({}, context)).toMatchObject({ ready: false, limitations: [expect.stringMatching(/protocol/)] });
  });

  it('keeps Windows x64 on its own helper and tool set', () => {
    const plugin = createComputerControlPlugin('win32', 'x64');
    expect(names(plugin.tools)).toContain('computer_app_catalog');
    expect(names(plugin.tools)).not.toContain('computer_get_app_state');
  });

  it.each([['linux', 'x64'], ['win32', 'arm64']] as const)('reports %s %s as unsupported through computer_status alone', async (platform, arch) => {
    const plugin = createComputerControlPlugin(platform, arch);
    expect(names(plugin.tools)).toEqual(['computer_status']);
    const [status] = plugin.tools ?? [];
    expect(await status?.handler({}, context)).toEqual({ platform, architecture: arch, ready: false, limitations: ['Unsupported platform or architecture'] });
  });

  it('asks before every tool on every platform', () => {
    for (const plugin of [createComputerControlPlugin('darwin', 'arm64', profile(ready)), createComputerControlPlugin('win32', 'x64'), createComputerControlPlugin('linux', 'x64')]) {
      for (const tool of plugin.tools ?? []) expect(tool.permission?.action, tool.name).toBe('prompt');
    }
  });
});
