import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateLegacyChats } from './chatPersistence.js';
import type { KeyValueStore } from './platform.js';
import { __setApiOverride } from './transport.js';

/** Minimal in-memory KeyValueStore for the migration parser. */
class FakeKv implements KeyValueStore {
  private readonly map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, v);
  }
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
}

const v2Blob = (events: unknown[]) => JSON.stringify({ version: 2, events });

afterEach(() => {
  __setApiOverride(null);
  vi.restoreAllMocks();
});

describe('migrateLegacyChats', () => {
  it('is a no-op when no KeyValueStore is registered', async () => {
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    await migrateLegacyChats(undefined);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('forwards only v2 blobs with events, then removes keys and sets the flag', async () => {
    const kv = new FakeKv({
      'moxxy:chat:ws1': v2Blob([{ id: 'e1' }, { id: 'e2' }]),
      'moxxy:chat:ws2': v2Blob([]), // empty -> not forwarded but still removed
      'unrelated:key': 'keep-me',
    });
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    await migrateLegacyChats(kv);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('chat.migrate', {
      workspaces: [{ workspaceId: 'ws1', events: [{ id: 'e1' }, { id: 'e2' }] }],
    });
    // Both legacy keys removed; unrelated key untouched; flag set.
    expect(kv.has('moxxy:chat:ws1')).toBe(false);
    expect(kv.has('moxxy:chat:ws2')).toBe(false);
    expect(kv.has('unrelated:key')).toBe(true);
    expect(kv.getItem('moxxy:chat:migrated-to-ndjson')).toBe('1');
  });

  it('does nothing when the migrated flag is already set', async () => {
    const kv = new FakeKv({
      'moxxy:chat:migrated-to-ndjson': '1',
      'moxxy:chat:ws1': v2Blob([{ id: 'e1' }]),
    });
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    await migrateLegacyChats(kv);

    expect(invoke).not.toHaveBeenCalled();
    // Existing blob left intact — the guard short-circuits before any delete.
    expect(kv.has('moxxy:chat:ws1')).toBe(true);
  });

  it('does NOT delete keys or set the flag when chat.migrate throws (retry next boot)', async () => {
    const kv = new FakeKv({
      'moxxy:chat:ws1': v2Blob([{ id: 'e1' }]),
    });
    const invoke = vi.fn(async () => {
      throw new Error('IPC down');
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    await migrateLegacyChats(kv);

    // Data preserved; flag unset so the next boot retries.
    expect(kv.has('moxxy:chat:ws1')).toBe(true);
    expect(kv.getItem('moxxy:chat:migrated-to-ndjson')).toBeNull();
  });

  it('skips wrong-version and corrupt blobs (not forwarded) but still removes them', async () => {
    const kv = new FakeKv({
      'moxxy:chat:old': JSON.stringify({ version: 1, events: [{ id: 'x' }] }),
      'moxxy:chat:broken': '{not json',
      'moxxy:chat:good': v2Blob([{ id: 'g' }]),
    });
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    await migrateLegacyChats(kv);

    // Only the v2 blob is forwarded.
    expect(invoke).toHaveBeenCalledWith('chat.migrate', {
      workspaces: [{ workspaceId: 'good', events: [{ id: 'g' }] }],
    });
    // All matched legacy keys removed regardless of validity.
    expect(kv.has('moxxy:chat:old')).toBe(false);
    expect(kv.has('moxxy:chat:broken')).toBe(false);
    expect(kv.has('moxxy:chat:good')).toBe(false);
  });
});
