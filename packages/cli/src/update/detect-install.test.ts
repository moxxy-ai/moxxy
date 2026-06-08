import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';

import { detectInstall, formatCmd } from './detect-install.js';

/** Build a file:// URL for a fake install path so detectInstall can resolve it. */
function at(p: string): string {
  return pathToFileURL(p).href;
}

describe('detectInstall', () => {
  it('detects a workspace/source checkout (no install command)', () => {
    const info = detectInstall({ fromUrl: at('/home/me/blocky/packages/cli/dist/commands/update.js') });
    expect(info.manager).toBe('workspace');
    expect(info.cmd).toEqual([]);
  });

  it('defaults to npm global', () => {
    const info = detectInstall({
      fromUrl: at('/usr/local/lib/node_modules/@moxxy/cli/dist/commands/update.js'),
      userAgent: '',
      cwd: '/home/me/project',
    });
    expect(info.manager).toBe('npm');
    expect(info.global).toBe(true);
    expect(formatCmd(info.cmd)).toBe('npm install -g @moxxy/cli@latest');
  });

  it('honors the npm_config_user_agent hint (pnpm)', () => {
    const info = detectInstall({
      fromUrl: at('/opt/whatever/@moxxy/cli/dist/commands/update.js'),
      userAgent: 'pnpm/9.1.0 npm/? node/v20.10.0 linux x64',
      cwd: '/home/me/project',
    });
    expect(info.manager).toBe('pnpm');
    expect(formatCmd(info.cmd)).toBe('pnpm add -g @moxxy/cli@latest');
  });

  it('detects pnpm from the install path', () => {
    const info = detectInstall({
      fromUrl: at('/home/me/Library/pnpm/global/5/node_modules/@moxxy/cli/dist/commands/update.js'),
      userAgent: '',
      cwd: '/somewhere/else',
    });
    expect(info.manager).toBe('pnpm');
  });

  it('detects bun from the install path', () => {
    const info = detectInstall({
      fromUrl: at('/home/me/.bun/install/global/node_modules/@moxxy/cli/dist/commands/update.js'),
      userAgent: '',
      cwd: '/somewhere/else',
    });
    expect(info.manager).toBe('bun');
    expect(formatCmd(info.cmd)).toBe('bun add -g @moxxy/cli@latest');
  });

  it('builds the yarn global form', () => {
    const info = detectInstall({
      fromUrl: at('/opt/x/@moxxy/cli/dist/commands/update.js'),
      userAgent: 'yarn/1.22.19 npm/? node/v20',
      cwd: '/p',
    });
    expect(formatCmd(info.cmd)).toBe('yarn global add @moxxy/cli@latest');
  });

  it('treats an install under the project node_modules as local (not -g)', () => {
    const info = detectInstall({
      fromUrl: at('/home/me/project/node_modules/@moxxy/cli/dist/commands/update.js'),
      userAgent: '',
      cwd: '/home/me/project',
    });
    expect(info.global).toBe(false);
    expect(formatCmd(info.cmd)).toBe('npm install @moxxy/cli@latest');
  });
});
