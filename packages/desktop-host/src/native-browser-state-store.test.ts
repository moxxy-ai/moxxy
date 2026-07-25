import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeBrowserStateStore } from './native-browser-state-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('NativeBrowserStateStore', () => {
  it('persists workspace tab state atomically and reads it back', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'moxxy-native-browser-'));
    roots.push(root);
    const file = path.join(root, 'state.json');
    const store = new NativeBrowserStateStore(file);
    const state = [
      {
        workspaceId: 'workspace-1',
        activeTabId: 'tab-2',
        tabs: [
          { id: 'tab-1', url: 'about:blank' },
          { id: 'tab-2', url: 'https://example.com' },
        ],
      },
    ];

    await store.save(state);

    expect(await store.load()).toEqual(state);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, workspaces: state });
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('quarantines malformed persisted JSON instead of overwriting it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'moxxy-native-browser-'));
    roots.push(root);
    const file = path.join(root, 'state.json');
    const store = new NativeBrowserStateStore(file);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, '{broken', 'utf8'));

    expect(await store.load()).toEqual([]);

    const names = await readdir(root);
    expect(names).not.toContain('state.json');
    expect(names.some((name) => name.startsWith('state.json.corrupt-'))).toBe(true);
  });

  it('rejects unsafe URLs and duplicate tab ids read from disk', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'moxxy-native-browser-'));
    roots.push(root);
    const file = path.join(root, 'state.json');
    const store = new NativeBrowserStateStore(file);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            workspaceId: 'workspace-1',
            activeTabId: 'same',
            tabs: [
              { id: 'same', url: 'javascript:alert(1)' },
              { id: 'same', url: 'https://example.com' },
            ],
          },
        ],
      }),
      'utf8',
    );

    expect(await store.load()).toEqual([]);
    expect((await readdir(root)).some((name) => name.startsWith('state.json.corrupt-'))).toBe(true);
  });
});
