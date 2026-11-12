/**
 * npm is the external boundary: the spawn is recorded and answered as npm
 * would, so the options Moxxy starts it with can be read on any platform.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

const spawned = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@moxxy/sdk/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moxxy/sdk/server')>()),
  resolveExecutableTarget: () => ({ kind: 'direct', command: 'C:\\Program Files\\nodejs\\npm.exe' }),
  spawnExecutableTarget: (_target: unknown, _args: unknown, opts: Record<string, unknown>) => {
    spawned.push(opts);
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    queueMicrotask(() => child.emit('close', 0));
    return child;
  },
}));

const { installClaudeAgentSdk } = await import('./sdk-install.js');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeDirSync(root);
});

describe('installing the Claude Agent SDK', () => {
  it('runs npm with no console window on Windows', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'moxxy-claude-sdk-hidden-'));
    roots.push(home);

    await installClaudeAgentSdk({ home, version: '0.0.1' });

    expect(spawned.at(-1)).toMatchObject({ windowsHide: true });
  });
});
