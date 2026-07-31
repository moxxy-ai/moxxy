import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sweepStaleSockets } from './sweep-sockets';

let root = '';
let previousMoxxyHome: string | undefined;

beforeEach(() => {
  previousMoxxyHome = process.env.MOXXY_HOME;
  root = mkdtempSync(path.join(tmpdir(), 'moxxy-socket-sweep-'));
  process.env.MOXXY_HOME = path.join(root, 'profile');
});

afterEach(() => {
  if (previousMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = previousMoxxyHome;
  rmSync(root, { recursive: true, force: true });
});

describe('sweepStaleSockets', () => {
  it('only scans the active MOXXY_HOME desktop socket directory', async () => {
    const home = process.env.MOXXY_HOME;
    if (!home) throw new Error('MOXXY_HOME is set by the test');
    const sockets = path.join(home, 'desktop', 'sockets');
    const stale = path.join(sockets, 'serve-stale.sock');
    mkdirSync(sockets, { recursive: true });
    writeFileSync(stale, 'not a live unix socket');

    const result = await sweepStaleSockets();

    expect(result.killed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
  });
});
