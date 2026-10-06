// One live trial of the agent's browser tools against the trial window (main.mjs).
// usage: node apps/desktop/scripts/browser-trial/run.mjs --out <dir> (--prompt <file> | --probe <module>) [--url <start page>] [--model gpt-6-luna]
// `--url fixture:<name>` serves fixtures/<name> on 127.0.0.1 and starts there. The page as it ended is saved as final.png.
// `--probe <module>` runs no model: the module's default export gets (bridge client, log) and drives the window itself,
// which is how a fix is checked against Electron's own webview rather than a stand-in.
// MOXXY_HOME must point at a throwaway home whose config selects the model, effort and fast mode.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { summarize } from './summarize.mjs';
import { BridgeClient } from '../../../../packages/plugin-browser/dist/bridge-client.js';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    prompt: { type: 'string' },
    probe: { type: 'string' },
    url: { type: 'string' },
    model: { type: 'string' },
  },
});
if (!values.out || (!values.prompt && !values.probe)) {
  console.error('usage: run.mjs --out <dir> (--prompt <file> | --probe <module>) [--url <start page>] [--model <id>]');
  process.exit(64);
}
if (values.prompt && !process.env.MOXXY_HOME) {
  console.error('MOXXY_HOME must point at a throwaway home');
  process.exit(64);
}

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = resolve(values.out);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bridgeFile = join(out, 'bridge.json');

let startUrl = values.url ?? 'about:blank';
let fixtures = null;
if (startUrl.startsWith('fixture:')) {
  const page = readFileSync(fileURLToPath(new URL(`./fixtures/${basename(startUrl.slice('fixture:'.length))}`, import.meta.url)));
  fixtures = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page));
  await new Promise((done) => fixtures.listen(0, '127.0.0.1', done));
  startUrl = `http://127.0.0.1:${fixtures.address().port}/`;
}

const electron = join(repo, 'apps/desktop/node_modules/.bin/electron');
const harness = spawn(electron, [join(repo, 'apps/desktop/scripts/browser-trial/main.mjs'), `--user-data-dir=${join(out, 'userdata')}`], {
  env: { ...process.env, TRIAL_BRIDGE_FILE: bridgeFile, TRIAL_START_URL: startUrl, TRIAL_LOG: join(out, 'window.ndjson') },
  stdio: ['ignore', openSync(join(out, 'window.log'), 'w'), openSync(join(out, 'window.log'), 'a')],
});

const ready = await new Promise((done) => {
  const deadline = Date.now() + 30_000;
  const check = () => {
    if (existsSync(bridgeFile)) return done(true);
    if (harness.exitCode !== null || Date.now() > deadline) return done(false);
    setTimeout(check, 100);
  };
  check();
});
if (!ready) {
  harness.kill();
  console.error(`the trial window did not start; see ${join(out, 'window.log')}`);
  process.exit(1);
}

const { socketPath, token } = JSON.parse(readFileSync(bridgeFile, 'utf8'));

// The bridge is up before the first view has attached; a run that starts then finds "no open tab".
{
  const window = new BridgeClient({ socketPath, token });
  const deadline = Date.now() + 15_000;
  for (;;) {
    const listed = await window.call('tabs', { action: 'list' }).catch(() => null);
    if (listed?.tabs?.length) break;
    if (Date.now() > deadline) {
      console.error('the trial window opened no tab');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  window.close();
}

if (values.probe) {
  const probe = await import(pathToFileURL(resolve(values.probe)).href);
  const client = new BridgeClient({ socketPath, token });
  const lines = [];
  const log = (...parts) => {
    const line = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');
    lines.push(line);
    console.log(line);
  };
  let failed = false;
  try {
    await probe.default(client, log, { origin: startUrl });
  } catch (err) {
    failed = true;
    log('probe threw:', err instanceof Error ? err.stack ?? err.message : String(err));
  }
  writeFileSync(join(out, 'probe.txt'), `${lines.join('\n')}\n`);
  client.close();
  harness.kill();
  fixtures?.close();
  rmSync(bridgeFile, { force: true });
  process.exit(failed ? 1 : 0);
}

const started = Date.now();
const agent = spawn(process.execPath, [
  join(repo, 'packages/cli/dist/bin.js'), '--model', values.model ?? 'gpt-6-luna',
  '-p', readFileSync(values.prompt, 'utf8'), '--allow-all', '--output-format', 'json',
], {
  cwd: repo,
  env: { ...process.env, MOXXY_BROWSER_BRIDGE_SOCKET: socketPath, MOXXY_BROWSER_BRIDGE_TOKEN: token },
  stdio: ['ignore', openSync(join(out, 'events.json'), 'w'), openSync(join(out, 'stderr.log'), 'w')],
});
const code = await new Promise((done) => agent.on('exit', done));
writeFileSync(join(out, 'exit.txt'), `exit=${code} wall=${Math.round((Date.now() - started) / 1000)}s\n`);
const window = new BridgeClient({ socketPath, token });
const shot = await window.call('capture', {}).catch(() => null);
if (shot?.base64) writeFileSync(join(out, 'final.png'), Buffer.from(shot.base64, 'base64'));
window.close();
harness.kill();
fixtures?.close();
rmSync(bridgeFile, { force: true });

const summary = summarize(out);
writeFileSync(join(out, 'summary.txt'), `${summary}\n`);
console.log(summary);
