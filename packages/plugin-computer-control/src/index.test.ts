import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDef } from '@moxxy/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformProfile } from './backend/backend.js';
import { computerTools } from './contract/tools.js';
import { createComputerControlPlugin } from './index.js';
import { linuxProfile } from './linux/profile.js';
import { macosProfile } from './macos/profile.js';
import { windowsProfile } from './windows/profile.js';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

const directories: string[] = [];
afterEach(() => { for (const made of directories.splice(0)) removeDirSync(made); });

/** A profile whose helper files exist (or not) in a scratch directory; the helper is never started. */
function profile(manifest?: Record<string, unknown>, base: PlatformProfile = macosProfile): PlatformProfile {
  const directory = mkdtempSync(join(tmpdir(), 'moxxy-computer-index-'));
  directories.push(directory);
  const helperPath = join(directory, 'moxxy-computer');
  if (manifest) {
    writeFileSync(helperPath, 'binary');
    writeFileSync(`${helperPath}.json`, JSON.stringify(manifest));
  }
  return { ...base, helperPath };
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

  it('runs Windows x64 on the same tool set, human controls and live view as macOS', () => {
    const plugin = createComputerControlPlugin('win32', 'x64', profile({ ...ready, architecture: 'x64' }, windowsProfile));
    expect(names(plugin.tools)).toEqual(Object.keys(computerTools).sort());
    expect(names(plugin.tools)).not.toContain('computer_app_catalog');
    expect(plugin.hooks?.onBeforeProviderCall).toBeTypeOf('function');
    expect(plugin.surfaces?.map((surface) => surface.kind)).toEqual(['computer-preview']);
  });

  it('offers only computer_status, with the reason, when the Windows helper is missing', async () => {
    const plugin = createComputerControlPlugin('win32', 'x64', profile(undefined, windowsProfile));
    expect(names(plugin.tools)).toEqual(['computer_status']);
    const [status] = plugin.tools ?? [];
    expect(await status?.handler({}, context)).toEqual({
      platform: 'win32', architecture: 'x64', ready: false,
      limitations: [expect.stringMatching(/helper is missing.*full installer/s)],
    });
  });

  it('speaks one protocol on both platforms', () => {
    expect(windowsProfile).toMatchObject({ platform: 'win32', protocolVersion: macosProfile.protocolVersion });
    expect(windowsProfile.helperPath.replaceAll('\\', '/')).toMatch(/bin\/win32-x64\/moxxy-computer\.exe$/);
  });

  it('runs Linux on the same tool set with a live view of pictures', () => {
    const plugin = createComputerControlPlugin('linux', 'x64', profile({ ...ready, os: 'linux', architecture: 'x64' }, linuxProfile('x64')));
    expect(names(plugin.tools)).toEqual(Object.keys(computerTools).sort());
    expect(plugin.surfaces?.map((surface) => surface.kind)).toEqual(['computer-preview']);
    expect(linuxProfile('x64')).toMatchObject({ platform: 'linux', protocolVersion: macosProfile.protocolVersion, previewCodecs: ['jpeg'] });
    expect(linuxProfile('x64').helperPath.replaceAll('\\', '/')).toMatch(/bin\/linux-x64\/moxxy-computer$/);
    expect(linuxProfile('arm64').helperPath.replaceAll('\\', '/')).toMatch(/bin\/linux-arm64\/moxxy-computer$/);
  });

  it('offers only computer_status, with the reason, when the Linux helper is missing', async () => {
    const plugin = createComputerControlPlugin('linux', 'arm64', profile(undefined, linuxProfile('arm64')));
    expect(names(plugin.tools)).toEqual(['computer_status']);
    const [status] = plugin.tools ?? [];
    expect(await status?.handler({}, context)).toMatchObject({ platform: 'linux', ready: false, limitations: [expect.stringMatching(/helper is missing/)] });
  });

  it.each([['linux', 'ia32'], ['freebsd', 'x64'], ['win32', 'arm64']] as const)('reports %s %s as unsupported through computer_status alone', async (platform, arch) => {
    const plugin = createComputerControlPlugin(platform, arch);
    expect(names(plugin.tools)).toEqual(['computer_status']);
    const [status] = plugin.tools ?? [];
    expect(await status?.handler({}, context)).toEqual({ platform, architecture: arch, ready: false, limitations: ['Unsupported platform or architecture'] });
  });

  it('asks before every tool on every platform', () => {
    for (const plugin of [createComputerControlPlugin('darwin', 'arm64', profile(ready)), createComputerControlPlugin('win32', 'x64', profile({ ...ready, architecture: 'x64' }, windowsProfile)), createComputerControlPlugin('linux', 'ia32')]) {
      for (const tool of plugin.tools ?? []) expect(tool.permission?.action, tool.name).toBe('prompt');
    }
  });
});
