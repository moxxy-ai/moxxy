import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeChannelStatus } from '@moxxy/sdk/server';
import type { ParsedArgv } from '../argv.js';
import { runChannelsCommand } from './channels.js';

// These verbs are status-file-only (no session boot), so they're cheap to drive
// end-to-end against a temp MOXXY_HOME.

let home: string;
let prevHome: string | undefined;
let out: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'moxxy-channels-cli-'));
  prevHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  });
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const argv = (...positional: string[]): ParsedArgv => ({
  command: 'channels',
  flags: {},
  positional,
});

describe('moxxy channels status', () => {
  it('reports nothing running on an empty home', async () => {
    const code = await runChannelsCommand(argv('status'));
    expect(code).toBe(0);
    expect(out).toContain('no channels running');
  });

  it('lists a live channel with its pid and Request URL', async () => {
    writeChannelStatus({
      name: 'slack',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      requestUrl: 'https://example.test/slack',
    });
    const code = await runChannelsCommand(argv('status'));
    expect(code).toBe(0);
    expect(out).toContain('slack');
    expect(out).toContain(`pid ${process.pid}`);
    expect(out).toContain('https://example.test/slack');
  });
});

describe('moxxy channels stop', () => {
  it('is a no-op (exit 0) when the channel is not running', async () => {
    const code = await runChannelsCommand(argv('stop', 'slack'));
    expect(code).toBe(0);
    expect(out).toContain('is not running');
  });
});
