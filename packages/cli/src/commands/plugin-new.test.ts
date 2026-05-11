import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPluginNewCommand } from './plugin-new.js';

let tmpHome: string;
let origHome: string | undefined;
let origCwd: string;
let writeOut: string[];
let writeErr: string[];
let origStdoutWrite: typeof process.stdout.write;
let origStderrWrite: typeof process.stderr.write;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-pnew-'));
  origHome = process.env.HOME;
  // os.homedir() honors $HOME on POSIX; sufficient to mock the user home.
  process.env.HOME = tmpHome;
  origCwd = process.cwd();
  process.chdir(tmpHome);

  writeOut = [];
  writeErr = [];
  origStdoutWrite = process.stdout.write.bind(process.stdout);
  origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writeOut.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writeErr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(async () => {
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
  process.chdir(origCwd);
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

function makeArgv(positional: string[], flags: Record<string, string | boolean> = {}) {
  return {
    command: 'plugins',
    positional,
    flags,
  } as never;
}

describe('plugins new', () => {
  it('scaffolds package.json + index.mjs + README in ~/.moxxy/plugins/<name>', async () => {
    const code = await runPluginNewCommand(makeArgv(['new', 'greeter']));
    expect(code).toBe(0);
    const root = path.join(tmpHome, '.moxxy', 'plugins', 'greeter');
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.moxxy.plugin.entry).toBe('./index.mjs');
    expect(pkg.name).toBe('moxxy-plugin-greeter');
    const entry = await fs.readFile(path.join(root, 'index.mjs'), 'utf8');
    expect(entry).toContain(`name: 'greeter'`);
    expect(entry).toContain("__moxxy: 'plugin'");
    expect((await fs.readFile(path.join(root, 'README.md'), 'utf8')).length).toBeGreaterThan(0);
  });

  it('refuses to clobber an existing dir without --force', async () => {
    await runPluginNewCommand(makeArgv(['new', 'dup']));
    writeOut = [];
    writeErr = [];
    const code = await runPluginNewCommand(makeArgv(['new', 'dup']));
    expect(code).toBe(1);
    expect(writeErr.join('')).toMatch(/refusing to overwrite/);
  });

  it('clobbers when --force is set', async () => {
    await runPluginNewCommand(makeArgv(['new', 'dup']));
    const root = path.join(tmpHome, '.moxxy', 'plugins', 'dup');
    await fs.writeFile(path.join(root, 'sentinel'), 'before');
    const code = await runPluginNewCommand(makeArgv(['new', 'dup'], { force: true }));
    expect(code).toBe(0);
    // index.mjs got regenerated; sentinel remains because we don't clear.
    const entry = await fs.readFile(path.join(root, 'index.mjs'), 'utf8');
    expect(entry).toContain(`name: 'dup'`);
  });

  it('rejects invalid names', async () => {
    const code = await runPluginNewCommand(makeArgv(['new', '1bad']));
    expect(code).toBe(2);
    expect(writeErr.join('')).toMatch(/invalid plugin name/);
  });

  it('writes to ./<name> when --here is set', async () => {
    const code = await runPluginNewCommand(makeArgv(['new', 'localp'], { here: true }));
    expect(code).toBe(0);
    const here = path.join(tmpHome, 'localp', 'package.json');
    const pkg = JSON.parse(await fs.readFile(here, 'utf8'));
    expect(pkg.name).toBe('localp');
  });

  it('shows help and returns 2 when no name is given', async () => {
    const code = await runPluginNewCommand(makeArgv(['new']));
    expect(code).toBe(2);
    expect(writeOut.join('')).toMatch(/moxxy plugins new/);
  });
});
