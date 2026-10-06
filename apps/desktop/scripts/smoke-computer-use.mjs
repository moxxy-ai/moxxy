import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Run through the installed Electron's Node runtime, from isolated installer resources.
const resources = process.argv[2];
if (!resources) throw new Error('Expected installed resources directory');
const root = path.join(resources, 'plugins-seed', 'node_modules', '@moxxy', 'plugin-computer-control');
const { default: plugin } = await import(pathToFileURL(path.join(root, 'dist', 'index.js')).href);
const tool = name => {
  const result = plugin.tools.find(item => item.name === name);
  assert.ok(result, 'Missing installed tool: ' + name);
  return result;
};
assert.ok(!plugin.tools.some(item => item.name === 'computer_observe'), 'A removed tool is still installed');
assert.ok(plugin.tools.every(item => item.permission.action === 'prompt'));

// The session log as dispatch writes it; access to an app is read back from here.
const events = [];
const log = {
  get length() { return events.length; },
  at: index => events[index],
  slice: (from, to) => events.slice(from, to),
  ofType: type => events.filter(event => event.type === type),
  byTurn: turnId => events.filter(event => event.turnId === turnId),
  toJSON: () => events,
};
const quiet = () => undefined;
const context = {
  sessionId: randomUUID(), turnId: randomUUID(), callId: 'smoke', cwd: process.cwd(),
  signal: AbortSignal.timeout(120_000), log,
  logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
};
const record = (type, fields) =>
  events.push({ id: 'e' + events.length, seq: events.length, ts: Date.now(), sessionId: context.sessionId, turnId: context.turnId, source: 'system', type, ...fields });
const call = async (name, input) => {
  console.log('Installed tool smoke:', name);
  const definition = tool(name);
  // Exercise the same input normalization as the runner.
  return definition.handler(definition.inputSchema.parse(input), context);
};
const text = output => (typeof output === 'string' ? output : (output.forModel ?? JSON.stringify(output)));

const codexTranslator = path.join(resources, 'plugins-seed', 'node_modules', '@moxxy', 'plugin-provider-openai-codex', 'dist', 'translate.js');
const { toResponsesTools } = await import(pathToFileURL(codexTranslator).href);
const outgoing = toResponsesTools(plugin.tools).find(item => item.name === 'computer_get_app_state');
assert.deepEqual(outgoing.parameters, tool('computer_get_app_state').inputJsonSchema, 'Provider discarded the bundled tool schema');
let fixture;
let directory;
try {
  const result = await call('computer_status', {});
  assert.equal(result.platform, 'win32');
  assert.ok(result.permissions.accessibility && result.permissions.screenRecording);
  console.log('Installed Computer Use extension and native helper handshake passed');
  if (!result.ready) {
    console.log('not-tested: installed tool invocation GUI has no interactive desktop');
  } else {
    const fixturePath = process.argv[3];
    assert.ok(fixturePath, 'Expected real fixture executable');
    directory = await mkdtemp(path.join(tmpdir(), 'moxxy-cu-tool-smoke-'));
    const statePath = path.join(directory, 'fixture.json');
    fixture = spawn(fixturePath, [statePath], { shell: false, stdio: 'ignore' });
    await once(fixture, 'spawn');
    const app = path.basename(fixturePath, '.exe');
    let listed;
    for (let attempt = 0; attempt < 40 && !listed; attempt++) {
      listed = (await call('computer_list_apps', { query: app })).apps.find(item => item.running);
      if (!listed) await delay(100);
    }
    assert.ok(listed, 'Fixture window not discovered');
    await assert.rejects(call('computer_get_app_state', { app }), /not granted/, 'An app was observed without a grant');

    const request = { apps: [app], reason: 'Installer smoke test' };
    record('tool_call_requested', { callId: 'grant', name: 'computer_request_access', input: request });
    record('tool_call_approved', { callId: 'grant', decidedBy: 'resolver', mode: 'allow' });
    const grant = await call('computer_request_access', request);
    record('tool_result', { callId: 'grant', ok: true, output: grant });
    assert.equal(grant.granted.length, 1, 'The fixture was not granted: ' + JSON.stringify(grant));
    assert.equal(grant.granted[0].tier, 'full');

    const state = await call('computer_get_app_state', { app });
    const field = /\[(\d+)\] Edit(?![^\n]*<secure>)/.exec(text(state));
    assert.ok(field, 'Editor missing in the app state:\n' + text(state));
    assert.ok(!text(state).includes('fixture-secret'), 'Protected text reached the model');
    assert.ok(state.base64 && state.mediaType === 'image/jpeg', 'No screenshot came with the app state');
    const expected = 'Zażółć gęślą jaźń.\nTo jest test Moxxy na Windowsie.\nTrzecia linia: ✅';
    const clicked = await call('computer_click', { app, element_index: Number(field[1]) });
    assert.match(text(clicked), /delivered/, 'Click was not delivered:\n' + text(clicked));
    const typed = await call('computer_type_text', { app, text: expected });
    assert.match(text(typed), /delivered/, 'Typing was not delivered:\n' + text(typed));
    await delay(300);
    const written = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(written.text.replaceAll('\r', ''), expected, 'Installed plugin wrote incorrect text');
    console.log('passed: installed model-facing schema -> grant -> app state -> click -> type -> real fixture text');
  }
} finally {
  await plugin.hooks.onShutdown(context);
  if (fixture && fixture.pid && fixture.exitCode === null && fixture.signalCode === null) {
    const closed = once(fixture, 'close');
    fixture.kill();
    await closed;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
