import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ParsedArgv } from '../argv.js';
import { findSpec, runServiceCommand } from './service.js';

// HOME + MOXXY_HOME point at a temp dir so the unit/log paths never touch the
// real ~/Library/LaunchAgents; nothing here installs anything.
let home: string;
let out: string;
const prev = { HOME: process.env.HOME, MOXXY_HOME: process.env.MOXXY_HOME };
const origWrite = process.stdout.write.bind(process.stdout);

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'moxxy-svc-cmd-'));
  process.env.HOME = home;
  process.env.MOXXY_HOME = path.join(home, '.moxxy');
  out = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
});

afterEach(async () => {
  process.stdout.write = origWrite;
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(home, { recursive: true, force: true });
});

const argv = (positional: string[], flags: ParsedArgv['flags'] = {}): ParsedArgv => ({
  command: 'service',
  positional,
  flags,
});

describe('moxxy service — discord', () => {
  it('knows a discord unit that runs the paired bot headless (--no-wizard), as JSON', async () => {
    const code = await runServiceCommand(argv(['status', 'discord'], { json: true }));

    expect(code).toBe(0);
    const status = JSON.parse(out) as Record<string, unknown>;
    expect(status).toMatchObject({
      service: 'discord',
      installed: false,
      running: false,
      cmd: 'moxxy discord --no-wizard',
    });
  });

  it('keeps the human-readable status when --json is not passed', async () => {
    await runServiceCommand(argv(['status', 'discord']));
    expect(() => JSON.parse(out)).toThrow();
    expect(out).toMatch(/discord/);
  });
});

describe('moxxy service — telegram', () => {
  it('runs the paired bot headless with the same profile as the discord unit', () => {
    const headless = { MOXXY_NO_WEB_SURFACE: '1', MOXXY_NO_CORE_UPDATE: '1' };

    expect(findSpec('telegram')).toMatchObject({ execArgs: ['telegram', '--no-wizard'], env: headless });
    expect(findSpec('discord')?.env).toEqual(headless);
  });
});
