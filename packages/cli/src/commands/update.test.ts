import { describe, expect, it } from 'vitest';

import { runUpdateCommand, type UpdateDeps } from './update.js';
import type { ParsedArgv } from '../argv.js';
import type { InstallInfo } from '../update/detect-install.js';
import type { CliUpdateCheck } from '../update/check.js';

function argv(flags: Record<string, string | boolean> = {}): ParsedArgv {
  return { command: 'update', flags, positional: [] };
}

const npmGlobal: InstallInfo = {
  manager: 'npm',
  global: true,
  pkg: '@moxxy/cli',
  cmd: ['npm', 'install', '-g', '@moxxy/cli@latest'],
  installPath: '/usr/local/lib/node_modules/@moxxy/cli',
};

const workspace: InstallInfo = {
  manager: 'workspace',
  global: false,
  pkg: '@moxxy/cli',
  cmd: [],
  installPath: '/repo/packages/cli',
};

/** Capture stdout + record any command that would have run. */
function harness(over: Partial<UpdateDeps> = {}) {
  let out = '';
  const ran: string[][] = [];
  const deps: UpdateDeps = {
    current: '0.5.3',
    detect: () => npmGlobal,
    run: async (cmd) => {
      ran.push([...cmd]);
      return 0;
    },
    interactive: false,
    out: (s) => {
      out += s;
    },
    ...over,
  };
  return { deps, ran, get out() {
    return out;
  } };
}

const available = (latest = '0.5.5', current = '0.5.3'): CliUpdateCheck => ({
  current,
  latest,
  updateAvailable: true,
});

describe('runUpdateCommand', () => {
  it('--help prints help and does nothing', async () => {
    const h = harness({ check: async () => available() });
    const code = await runUpdateCommand(argv({ help: true }), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toHaveLength(0);
    expect(h.out).toBe(''); // help goes to process.stdout directly, not our `out`
  });

  it('reports up-to-date and does not run', async () => {
    const h = harness({ check: async () => ({ current: '0.5.5', latest: '0.5.5', updateAvailable: false }) });
    const code = await runUpdateCommand(argv(), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toHaveLength(0);
    expect(h.out).toMatch(/latest/i);
  });

  it('--check reports the command but never runs it', async () => {
    const h = harness({ check: async () => available() });
    const code = await runUpdateCommand(argv({ check: true }), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toHaveLength(0);
    expect(h.out).toContain('npm install -g @moxxy/cli@latest');
    expect(h.out).toMatch(/0\.5\.3.*0\.5\.5/s);
  });

  it('--yes runs the detected upgrade command', async () => {
    const h = harness({ check: async () => available() });
    const code = await runUpdateCommand(argv({ yes: true }), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toEqual([['npm', 'install', '-g', '@moxxy/cli@latest']]);
  });

  it('propagates a non-zero exit code from the upgrade', async () => {
    const h = harness({ check: async () => available(), run: async () => 1 });
    const code = await runUpdateCommand(argv({ yes: true }), h.deps);
    expect(code).toBe(1);
  });

  it('non-interactive without --yes prints the command but does not run it', async () => {
    const h = harness({ check: async () => available(), interactive: false });
    const code = await runUpdateCommand(argv(), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toHaveLength(0);
    expect(h.out).toMatch(/--yes/);
  });

  it('interactive confirm=yes runs; confirm=no does not', async () => {
    const yes = harness({ check: async () => available(), interactive: true, promptConfirm: async () => true });
    expect(await runUpdateCommand(argv(), yes.deps)).toBe(0);
    expect(yes.ran).toHaveLength(1);

    const no = harness({ check: async () => available(), interactive: true, promptConfirm: async () => false });
    expect(await runUpdateCommand(argv(), no.deps)).toBe(0);
    expect(no.ran).toHaveLength(0);
  });

  it('a source checkout advises git, never installs', async () => {
    const h = harness({ check: async () => available(), detect: () => workspace });
    const code = await runUpdateCommand(argv({ yes: true }), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toHaveLength(0);
    expect(h.out).toMatch(/git pull/);
  });

  it('offline (null check) degrades to a manual hint, returns 0', async () => {
    const h = harness({ check: async () => null });
    const code = await runUpdateCommand(argv(), h.deps);
    expect(code).toBe(0);
    expect(h.ran).toHaveLength(0);
    expect(h.out).toContain('npm install -g @moxxy/cli@latest');
  });
});
