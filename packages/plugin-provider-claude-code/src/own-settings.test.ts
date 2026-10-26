/**
 * The person's own Claude settings decide how a Claude Moxxy starts runs when
 * Moxxy names no mode. Moxxy reads them the way Claude does (the SDK's own
 * resolver, with its trust filter for a mode a repository sets), so the
 * conversation's auto-approve is the truth before Claude ever starts. The SDK
 * is the external boundary.
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { FakeClaude } from './fake-claude.testkit.js';
import { claudeOwnAutoApprove, ownPermissionMode } from './own-settings.js';
import { installedClaudeAgentSdk } from './sdk-install.js';
import type { ClaudeAgentSdk } from './sdk-types.js';

const nothing = async function* () {};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeDirSync(root);
});

describe("the person's own Claude mode", () => {
  it('is the default mode Claude would honor for the folder', async () => {
    const claude = new FakeClaude(nothing, 'bypassPermissions');

    expect(await ownPermissionMode(claude, '/work/app')).toBe('bypassPermissions');
    expect(claude.settingsRead).toEqual(['/work/app']);
  });

  it('leaves out a mode the trust filter drops, as Claude does for one a repository sets', async () => {
    const claude = new FakeClaude(nothing, 'bypassPermissions');
    claude.fromRepository = true;

    expect(await ownPermissionMode(claude, '/work/app')).toBeUndefined();
  });

  it('is unknown with an SDK that cannot resolve settings, or when resolving fails', async () => {
    const old: ClaudeAgentSdk = { query: () => ({}) as never };
    const broken = new FakeClaude(nothing, 'bypassPermissions');
    broken.settingsError = new Error('managed settings unreadable');

    expect(await ownPermissionMode(old, '/work/app')).toBeUndefined();
    expect(await ownPermissionMode(broken, '/work/app')).toBeUndefined();
  });
});

describe("the auto-approve of the person's own Claude", () => {
  it('is on for bypass permissions, off for a mode that asks, and unknown for one Moxxy has no switch for', async () => {
    const own = (mode: ConstructorParameters<typeof FakeClaude>[1]) =>
      claudeOwnAutoApprove('/work/app', { load: async () => new FakeClaude(nothing, mode) });

    expect(await own('bypassPermissions')).toBe(true);
    expect(await own('acceptEdits')).toBe(false);
    expect(await own('auto')).toBeUndefined();
  });

  it('is unknown, and installs nothing, while the SDK is not installed yet', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'moxxy-claude-own-'));
    roots.push(home);

    expect(await installedClaudeAgentSdk({ home })).toBeUndefined();
    expect(await claudeOwnAutoApprove('/work/app', { load: async () => undefined })).toBeUndefined();
    expect(readdirSync(home)).toEqual([]);
    expect(existsSync(path.join(home, '0.3.296'))).toBe(false);
  });
});
