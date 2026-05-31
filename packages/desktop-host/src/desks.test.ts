import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { DeskStore } from './desks';

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'desks-'));
  storePath = path.join(tmp, 'desks.json');
});

describe('DeskStore', () => {
  it('returns an empty doc for a missing file', async () => {
    const s = new DeskStore(storePath);
    const list = await s.list();
    expect(list).toEqual([]);
    expect(await s.getActive()).toBeNull();
  });

  it('returns an empty doc for a malformed file', async () => {
    writeFileSync(storePath, '{not json');
    const s = new DeskStore(storePath);
    expect(await s.list()).toEqual([]);
  });

  it('create() persists and auto-activates the first desk', async () => {
    const s = new DeskStore(storePath);
    const desk = await s.create({ name: 'Personal', cwd: '/tmp' });
    expect(desk.id).toBeTruthy();
    expect((await s.list())).toHaveLength(1);
    expect((await s.getActive())?.id).toBe(desk.id);

    // Persistence survives a fresh store instance.
    const fresh = new DeskStore(storePath);
    expect((await fresh.list())[0]!.name).toBe('Personal');
  });

  it('cycles default colors as desks are created', async () => {
    const s = new DeskStore(storePath);
    const a = await s.create({ name: 'A', cwd: '/a' });
    const b = await s.create({ name: 'B', cwd: '/b' });
    expect(a.color).not.toBe(b.color);
  });

  it('setActive() rejects unknown ids', async () => {
    const s = new DeskStore(storePath);
    await expect(s.setActive('nope')).rejects.toThrow(/unknown/);
  });

  it('remove() promotes another desk to active when active is removed', async () => {
    const s = new DeskStore(storePath);
    const a = await s.create({ name: 'A', cwd: '/a' });
    const b = await s.create({ name: 'B', cwd: '/b' });
    await s.setActive(a.id);
    await s.remove(a.id);
    expect((await s.getActive())?.id).toBe(b.id);
  });

  it('atomic write leaves no tmp file behind', async () => {
    const s = new DeskStore(storePath);
    await s.create({ name: 'X', cwd: '/x' });
    const leftovers = readdirSync(tmp).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('serializes concurrent creates without clobbering (no lost desks)', async () => {
    const s = new DeskStore(storePath);
    // Fire 8 creates concurrently. Without the mutex each would read the same
    // empty doc and the last save would win, leaving far fewer than 8 desks.
    await Promise.all(
      Array.from({ length: 8 }, (_unused, i) => s.create({ name: `D${i}`, cwd: `/d${i}` })),
    );
    expect(await s.list()).toHaveLength(8);
  });

  it('remove racing setActive never strands activeId on a deleted desk', async () => {
    const s = new DeskStore(storePath);
    const a = await s.create({ name: 'A', cwd: '/a' });
    const b = await s.create({ name: 'B', cwd: '/b' });
    // Interleave the two mutations; whatever the order, activeId must point at
    // a desk that still exists (or be null if everything was removed).
    await Promise.all([s.remove(a.id), s.setActive(a.id).catch(() => {})]);
    const active = await s.getActive();
    const ids = (await s.list()).map((d) => d.id);
    if (active) expect(ids).toContain(active.id);
    expect(ids).toContain(b.id);
  });

  it('write uses pretty JSON', async () => {
    const s = new DeskStore(storePath);
    await s.create({ name: 'X', cwd: '/x' });
    const body = readFileSync(storePath, 'utf8');
    expect(body).toContain('\n');
    expect(body).toContain('"name": "X"');
  });
});
