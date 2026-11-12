/**
 * The OpenCode commands Moxxy runs to check OpenCode (`auth list`, `models`,
 * `debug config`, `debug agent`). On OpenCode 2 each one starts the shared
 * background server when none runs, and that server keeps their environment
 * and stays after Moxxy quits. A stand-in `opencode` (the external boundary)
 * records what it was given.
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { checkOpenCode, listOpenCodeModels, readOpenCodeMcpServers, readOpenCodeRules } from './login.js';

const roots: string[] = [];
const saved = { token: process.env.MOXXY_BROWSER_BRIDGE_TOKEN, electron: process.env.ELECTRON_RUN_AS_NODE, home: process.env.MOXXY_HOME };
afterEach(() => {
  for (const root of roots.splice(0)) removeDirSync(root);
  const restore = (key: string, value: string | undefined) => (value === undefined ? delete process.env[key] : (process.env[key] = value));
  restore('MOXXY_BROWSER_BRIDGE_TOKEN', saved.token);
  restore('ELECTRON_RUN_AS_NODE', saved.electron);
  restore('MOXXY_HOME', saved.home);
});

interface FakeOpenCode {
  readonly file: string;
  /** The arguments of every run, in order. */
  runs(): string[][];
  /** The environment of the last run. */
  env(): Record<string, string>;
}

/**
 * An `opencode` of `version` whose `service status` prints `service` (a URL
 * when its shared server runs), or fails when null. With `standaloneTimesOut`
 * its private server fails as OpenCode's does when its plugins take longer
 * than the 5 seconds it allows them (a busy computer). Its shared server's
 * first `sharedTimeouts` answers time out the same way, as a shared server
 * still starting those plugins does.
 */
function fakeOpenCode(version: string, service: string | null, standaloneTimesOut = false, sharedTimeouts = 0): FakeOpenCode {
  const root = mkdtempSync(path.join(tmpdir(), 'moxxy-opencode-cli-'));
  roots.push(root);
  const log = path.join(root, 'runs.ndjson');
  const env = path.join(root, 'env.json');
  const shared = path.join(root, 'shared-runs');
  const file = path.join(root, 'opencode');
  const script = `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
    fs.writeFileSync(${JSON.stringify(env)}, JSON.stringify(process.env));
    const said = args.filter((arg) => arg !== '--standalone').join(' ');
    const timedOut = () => { console.error('Location plugins did not finish activating'); process.exit(1); };
    if (${JSON.stringify(standaloneTimesOut)} && args.includes('--standalone')) timedOut();
    if (!args.includes('--standalone') && said !== '--version' && said !== 'service status') {
      fs.appendFileSync(${JSON.stringify(shared)}, 'x');
      if (fs.readFileSync(${JSON.stringify(shared)}, 'utf8').length <= ${sharedTimeouts}) timedOut();
    }
    if (said === '--version') console.log(${JSON.stringify(version)});
    else if (said === 'service status') { const out = ${JSON.stringify(service)}; if (out === null) process.exit(1); console.log(out); }
    else if (said === 'models') console.log('opencode/big-pickle');
    else if (said === 'debug config') console.log('{"mcp":{}}');
    else if (said.startsWith('debug agent')) console.log('{"permission":[]}');
    else console.log('0 credentials');
  `;
  writeFileSync(file, `#!${process.execPath}\n${script}`);
  chmodSync(file, 0o755);
  return {
    file,
    runs: () => readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]),
    env: () => JSON.parse(readFileSync(env, 'utf8')) as Record<string, string>,
  };
}

/** The runs that did the asked-for work, without the version and server checks around them. */
const work = (fake: FakeOpenCode) => fake.runs().filter((args) => args[0] !== '--version' && args[0] !== 'service');

describe.skipIf(process.platform === 'win32')('the OpenCode commands Moxxy runs to check it', () => {
  it("leave Moxxy's own variables out, since the server they may start keeps them", async () => {
    const fake = fakeOpenCode('2.2.5', 'http://127.0.0.1:4096');
    process.env.MOXXY_BROWSER_BRIDGE_TOKEN = 'bridge-secret';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.MOXXY_HOME = '/tmp/moxxy-home';

    await checkOpenCode(fake.file);

    const env = fake.env();
    expect(Object.keys(env).filter((key) => key.startsWith('MOXXY_') && key !== 'MOXXY_HOME')).toEqual([]);
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.MOXXY_HOME).toBe('/tmp/moxxy-home');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("run on OpenCode 2's own private server when its shared one is not running, so nothing of Moxxy's stays after it quits", async () => {
    const fake = fakeOpenCode('2.2.5', 'stopped');

    await checkOpenCode(fake.file);
    await listOpenCodeModels(fake.file);
    await readOpenCodeMcpServers(fake.file)({ cwd: tmpdir() });
    await readOpenCodeRules(fake.file)({ cwd: tmpdir(), agent: 'build' });

    expect(work(fake)).toEqual([
      ['auth', 'list', '--standalone'],
      ['models', '--standalone'],
      ['debug', 'config', '--standalone'],
      ['debug', 'agent', 'build', '--standalone'],
    ]);
  });

  it('use the shared server when it already runs, since it answers at once and was not started by Moxxy', async () => {
    const fake = fakeOpenCode('2.2.5', 'http://127.0.0.1:4096');

    await checkOpenCode(fake.file);
    await listOpenCodeModels(fake.file);

    expect(work(fake)).toEqual([['auth', 'list'], ['models']]);
  });

  it('ask again through the shared server when the private one did not start in time, so a busy computer still gets an answer', async () => {
    const fake = fakeOpenCode('2.2.5', 'stopped', true);

    const status = await checkOpenCode(fake.file);
    const models = await listOpenCodeModels(fake.file);

    expect(status.state).toBe('signed-in');
    expect(models).toEqual(['opencode/big-pickle']);
    expect(work(fake)).toEqual([['auth', 'list', '--standalone'], ['auth', 'list'], ['models', '--standalone'], ['models']]);
  });

  it('ask the shared server again while it is still starting its plugins, since it goes on starting them after an answer times out', async () => {
    const fake = fakeOpenCode('2.2.6', 'stopped', true, 1);

    const status = await checkOpenCode(fake.file);

    expect(status.state).toBe('signed-in');
    expect(work(fake)).toEqual([['auth', 'list', '--standalone'], ['auth', 'list'], ['auth', 'list']]);
  });

  it('give up after three answers from the shared server, so plugins that never start do not keep Moxxy waiting', async () => {
    const fake = fakeOpenCode('2.2.6', 'stopped', true, 99);

    const status = await checkOpenCode(fake.file);

    expect(status).toMatchObject({ state: 'error', message: 'Could not run OpenCode: Location plugins did not finish activating' });
    expect(work(fake)).toEqual([['auth', 'list', '--standalone'], ['auth', 'list'], ['auth', 'list'], ['auth', 'list']]);
  });

  it('ask a shared server that was already running again too, as it starts plugins anew for a folder it has not served', async () => {
    const fake = fakeOpenCode('2.2.6', 'http://127.0.0.1:4096', false, 1);

    const status = await checkOpenCode(fake.file);

    expect(status.state).toBe('signed-in');
    expect(work(fake)).toEqual([['auth', 'list'], ['auth', 'list']]);
  });

  it('run as they are on OpenCode 1, which has no shared server and no --standalone', async () => {
    const fake = fakeOpenCode('1.19.4', null);

    await checkOpenCode(fake.file);

    expect(fake.runs()).toEqual([['--version'], ['auth', 'list']]);
  });

  it('run as they are when OpenCode cannot say whether its shared server runs', async () => {
    const fake = fakeOpenCode('2.2.5', null);

    await checkOpenCode(fake.file);

    expect(work(fake)).toEqual([['auth', 'list']]);
  });
});
