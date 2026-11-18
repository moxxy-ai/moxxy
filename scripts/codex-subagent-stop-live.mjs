// Live regression for stopping one Codex subagent. Uses the signed-in CLI and a temporary workspace.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitFor } from '../packages/sdk/dist/index.js';
import { removeWorkDir } from './agent-cli-env.mjs';
import { Session, collectTurn } from '../packages/core/dist/index.js';
import { defaultModePlugin } from '../packages/mode-default/dist/index.js';
import { codexAgentPlugin, codexSessions } from '../packages/plugin-provider-codex-agent/dist/index.js';

const cwd = mkdtempSync(path.join(tmpdir(), 'moxxy-stop-child-'));
const file = (name) => path.join(cwd, name);
const session = new Session({ cwd });
const model = process.env.MOXXY_LIVE_CODEX_MODEL || 'gpt-5.6-terra';
const controller = new AbortController();
const watcher = watch(cwd);
let turnError;
async function until(check, what, timeoutMs = 120_000) {
  const result = await waitFor(() => check() || undefined, {
    timeoutMs,
    signal: controller.signal,
    wakeOn: [
      (wake) => {
        watcher.on('change', wake);
        return () => watcher.off('change', wake);
      },
      (wake) => session.onInfoChanged(wake),
    ],
  });
  if (result.status !== 'ready') throw turnError ?? new Error(what);
}
let turn;
try {
  // Only the test releases the workers. The ready file identifies the OS process and its Codex thread.
  writeFileSync(file('probe.cjs'), `
const fs = require('node:fs');
const id = process.argv[2];
fs.writeFileSync(id + '.tmp', JSON.stringify({ pid: process.pid, thread: process.env.CODEX_THREAD_ID }));
fs.renameSync(id + '.tmp', id + '.ready');
function check() {
  if (fs.existsSync('release')) {
    fs.writeFileSync(id + '.done', id);
    process.exit(0);
  }
}
fs.watch('.', check);
setTimeout(() => process.exit(2), 150000);
check();
`);
  session.pluginHost.registerStatic(defaultModePlugin);
  session.pluginHost.registerStatic(codexAgentPlugin);
  session.providers.setActive('codex-agent', { model });
  await session.setAutoApprove(true);
  session.setReasoningEffort('ultra');
  const prompt = 'For this integration test use two real subagents. Ask one to run "node probe.cjs A" and the other "node probe.cjs B" in this working directory. Each agent should run its own command using exec_command in the foreground, wait for it, then finish. Do not run the commands yourself or modify any files. Leave both agents running, do not wait or close them, and reply STARTED.';
  const failed = (error) => {
    turnError = error;
    controller.abort();
  };
  turn = collectTurn(session, prompt, { model, signal: controller.signal }).then((events) => {
    const error = events.find(e => e.type === 'error');
    if (error) failed(new Error(error.message));
  }, failed);
  await until(() => existsSync(file('A.ready')) && existsSync(file('B.ready')), 'The two workers never started');
  const worker = (id) => JSON.parse(readFileSync(file(id + '.ready'), 'utf8'));
  const a = worker('A');
  const b = worker('B');
  console.log('Workers A and B started', a, b);
  assert.ok(a.thread && b.thread && a.thread !== b.thread, 'Both workers must report distinct Codex threads');
  const running = () => session.getInfo().backgroundWork ?? [];
  await until(() => [a, b].every(w => running().some(item => item.id === w.thread)), 'Moxxy did not list both workers');
  assert.equal(await session.stopBackgroundWork(a.thread), true);
  await until(() => !running().some(item => item.id === a.thread), 'Stopped worker still listed', 12_000);
  assert.throws(() => process.kill(a.pid, 0), { code: 'ESRCH' }, 'Stopped worker still has a live process');
  process.kill(b.pid, 0);
  assert.ok(running().some(item => item.id === b.thread), 'Other worker disappeared');
  writeFileSync(file('release'), 'go');
  await until(() => existsSync(file('B.done')), 'Other worker did not finish', 10_000);
  assert.equal(existsSync(file('A.done')), false);
  console.log('PASS: the stopped worker disappeared and only the other one wrote its completion file');
} finally {
  writeFileSync(file('release'), 'cleanup');
  controller.abort();
  watcher.close();
  await codexSessions().closeAll();
  if (turn) await turn;
  await session.close();
  const warning = await removeWorkDir(cwd);
  if (warning) console.warn(warning);
}
