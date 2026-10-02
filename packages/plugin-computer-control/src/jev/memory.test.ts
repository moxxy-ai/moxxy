import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppElement, AppTree } from '../contract/tree.js';
import { RunMemory, describeRoutes, recall } from './memory.js';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'moxxy-run-memory-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

const element = (index: number, key: string, title: string, role = 'button'): AppElement => ({ key, index, depth: 1, role, title });
const tree = (...elements: AppElement[]): AppTree => ({ app: 'Editor', elements: [{ key: 'w', index: 0, depth: 0, role: 'window' }, ...elements] });
const exportButton = { do: 'click' as const, target: 'the Export button', key: 'w/export', label: 'button\u001fExport', way: 1 };

describe('RunMemory', () => {
  it('keeps what worked for an app across restarts, and counts repeats instead of storing them twice', async () => {
    let time = 100;
    const memory = new RunMemory(directory, () => time);
    const route = { goal: 'Export the clip', steps: [{ do: 'click' as const, target: 'the Export button', expect: 'the export sheet shows' }] };
    await memory.learn('com.example.editor', { targets: [exportButton], route });
    time = 200;
    await memory.learn('com.example.editor', { targets: [{ ...exportButton, target: '  The EXPORT  button ', way: 0 }], route });
    const kept = await new RunMemory(directory).read('com.example.editor');
    expect(kept.targets).toEqual([{ do: 'click', target: 'the export button', key: 'w/export', label: 'button\u001fExport', way: 0, uses: 2, at: 200 }]);
    expect(kept.routes).toEqual([{ ...route, uses: 2, at: 200 }]);
    expect(await memory.read('com.example.other')).toEqual({ targets: [], routes: [] });
  });

  it('keeps concurrent lessons, all of them', async () => {
    const memory = new RunMemory(directory);
    await Promise.all(['a', 'b', 'c', 'd'].map((name) => memory.learn('app', { targets: [{ ...exportButton, target: name }] })));
    expect((await memory.read('app')).targets.map((target) => target.target).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(readdirSync(directory).filter((file) => file.includes('.tmp'))).toEqual([]);
  });

  it('forgets a target that stopped working', async () => {
    const memory = new RunMemory(directory);
    await memory.learn('app', { targets: [exportButton, { ...exportButton, target: 'Save' }] });
    await memory.forget('app', { do: 'click', target: 'The Export button' });
    expect((await memory.read('app')).targets.map((target) => target.target)).toEqual(['save']);
  });

  it('keeps the newest lessons when an app has too many', async () => {
    let time = 0;
    const memory = new RunMemory(directory, () => (time += 1));
    for (let index = 0; index < 205; index += 1) await memory.learn('app', { targets: [{ ...exportButton, target: `t${index}` }] });
    const { targets } = await memory.read('app');
    expect(targets).toHaveLength(200);
    expect(targets.some((target) => target.target === 't0')).toBe(false);
    expect(targets.some((target) => target.target === 't204')).toBe(true);
  });

  it('never fails a run: a broken file reads as empty and a place that cannot be written is skipped', async () => {
    const memory = new RunMemory(directory);
    await memory.learn('app', { targets: [exportButton] });
    const [file] = readdirSync(directory);
    writeFileSync(join(directory, file as string), '{ not json');
    expect(await memory.read('app')).toEqual({ targets: [], routes: [] });
    const blocked = join(directory, 'file');
    writeFileSync(blocked, '');
    const nowhere = new RunMemory(join(blocked, 'below'));
    await expect(nowhere.learn('app', { targets: [exportButton] })).resolves.toBeUndefined();
    expect(await nowhere.read('app')).toEqual({ targets: [], routes: [] });
  });

  it('stores an app under a file name that is safe on every system', async () => {
    const memory = new RunMemory(directory);
    await memory.learn('C:\\Program Files\\App/../x.exe', { targets: [exportButton] });
    const [file] = readdirSync(directory);
    expect(file).toMatch(/^[a-z0-9._-]+\.json$/);
    expect(JSON.parse(readFileSync(join(directory, file as string), 'utf8')).app).toBe('C:\\Program Files\\App/../x.exe');
    mkdirSync(join(directory, 'sub'));
  });
});

describe('recall', () => {
  const memory = { targets: [{ ...exportButton, target: 'the export button', uses: 1, at: 1 }], routes: [] };
  const step = { do: 'click' as const, target: 'The Export  button' };

  it('finds the remembered element by its place and label, with the way that worked', () => {
    const live = element(4, 'w/export', 'Export');
    expect(recall(memory, step, tree(element(3, 'w/cancel', 'Cancel'), live))).toEqual({ element: live, way: 1 });
    const withEffect = { targets: [{ ...memory.targets[0] as (typeof memory.targets)[number], effect: ['button\u001fSheet'] }], routes: [] };
    expect(recall(withEffect, step, tree(live))).toEqual({ element: live, way: 1, effect: ['button\u001fSheet'] });
  });

  it('finds it by its label alone when it moved, as long as only one element reads so', () => {
    const moved = element(7, 'w/toolbar/export', 'Export');
    expect(recall(memory, step, tree(moved))).toEqual({ element: moved, way: 1 });
    expect(recall(memory, step, tree(moved, element(8, 'w/menu/export', 'Export')))).toBeUndefined();
  });

  it('remembers nothing for another action, another target, or an element that now reads differently', () => {
    expect(recall(memory, { do: 'type', target: 'the export button', text: 'x' }, tree(element(4, 'w/export', 'Export')))).toBeUndefined();
    expect(recall(memory, { do: 'click', target: 'Save' }, tree(element(4, 'w/export', 'Export')))).toBeUndefined();
    expect(recall(memory, step, tree(element(4, 'w/export', 'Import')))).toBeUndefined();
    expect(recall(memory, { do: 'key', key: 'Return' }, tree())).toBeUndefined();
  });
});

describe('describeRoutes', () => {
  it('lists the most used routes as steps the model can send again', () => {
    const routes = [
      { goal: 'Open Sound', steps: [{ do: 'click' as const, target: 'Sound', expect: 'the Sound pane shows' }], uses: 1, at: 5 },
      { goal: 'Export', steps: [{ do: 'click' as const, target: 'Export' }, { do: 'key' as const, key: 'Return' }], uses: 3, at: 1 },
    ];
    const text = describeRoutes({ targets: [], routes }) ?? '';
    expect(text.indexOf('Export')).toBeLessThan(text.indexOf('Open Sound'));
    expect(text).toContain('{"do":"click","target":"Sound","expect":"the Sound pane shows"}');
    expect(text).toMatch(/computer_run/);
    expect(describeRoutes({ targets: [], routes: [] })).toBeUndefined();
  });
});
