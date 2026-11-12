/**
 * createTerminalProcess against a REAL shell: what a caller adds to its
 * environment reaches every command typed into it.
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTerminalProcess, type TerminalProcess } from './pty.js';

let term: TerminalProcess | undefined;
afterEach(() => term?.kill());

async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

describe.skipIf(process.platform === 'win32')('createTerminalProcess env', { timeout: 30_000 }, () => {
  it('gives the shell the variables it is asked to add, beside its own', async () => {
    term = await createTerminalProcess(os.tmpdir(), { env: { MOXXY_TEST_TAB: 'tab-42' } });
    let out = '';
    term.onData((data) => {
      out += data;
    });
    term.write('echo "mark:$MOXXY_TEST_TAB:${HOME:+home}"\r');
    await until(() => out.includes('mark:tab-42:home'));
    expect(out).toContain('mark:tab-42:home');
  });
});

describe.skipIf(process.platform === 'win32')('createTerminalProcess pid', { timeout: 30_000 }, () => {
  it("names the shell's process, so a host can stop what was started in it", async () => {
    term = await createTerminalProcess(os.tmpdir());
    const pid = term.pid;
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid as number, 0)).not.toThrow();
  });
});

describe.skipIf(process.platform === 'win32')('createTerminalProcess nodePtyFrom', { timeout: 30_000 }, () => {
  it('loads node-pty from where it is told: a host bundled without node_modules finds it beside the installed plugin', async () => {
    const pluginDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    term = await createTerminalProcess(os.tmpdir(), { nodePtyFrom: path.join(pluginDir, 'package.json') });
    expect(term.backend).toBe('pty');
  });
});
