import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@moxxy/sdk/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moxxy/sdk/server')>()),
  spawnExecutableTarget: (_target: unknown, _args: unknown, opts: Record<string, unknown>) => {
    spawned.push(opts);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => true });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('codex-cli 0.166.0\n'));
      child.emit('close', 0);
    });
    return child;
  },
}));

const { readCliVersion } = await import('./cli-version.js');

describe('reading a CLI version', () => {
  it('opens no console window on Windows, since a native agent such as Codex would show one', async () => {
    expect(await readCliVersion({ kind: 'direct', command: 'C:\\pnpm\\codex.exe' })).toBe('0.166.0');
    expect(spawned.at(-1)).toMatchObject({ windowsHide: true });
  });
});
