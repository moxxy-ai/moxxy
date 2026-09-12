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
const status = plugin.tools.find((tool) => tool.name === 'computer_status');
assert.ok(status, 'Installed extension did not expose status');
assert.ok(plugin.tools.some((tool) => tool.name === 'computer_observe'));
assert.ok(!plugin.tools.some((tool) => tool.name === 'computer_applescript'));
assert.ok(plugin.tools.every((tool) => tool.permission.action === 'prompt'));
const context = { sessionId: randomUUID(), turnId: randomUUID(), signal: AbortSignal.timeout(60_000) };
const tool = name => {
  const result = plugin.tools.find(item => item.name === name);
  assert.ok(result, 'Missing installed tool: ' + name);
  return result;
};
const call = async (name, input) => {
  console.log('Installed tool smoke:', name);
  const definition = tool(name);
  // Exercise the same input normalization and output validation as the runner.
  return definition.outputSchema.parse(await definition.handler(definition.inputSchema.parse(input), context));
};
assert.equal(tool('computer_open').inputJsonSchema.properties.timeoutMs.maximum, 8000);
assert.ok(tool('computer_observe').inputJsonSchema.properties.root.anyOf.some(branch => branch.type === 'null'));
assert.ok(!tool('computer_observe').inputJsonSchema.required.includes('root'));
const codexTranslator = path.join(resources, 'plugins-seed', 'node_modules', '@moxxy', 'plugin-provider-openai-codex', 'dist', 'translate.js');
const { toResponsesTools } = await import(pathToFileURL(codexTranslator).href);
const outgoing = toResponsesTools(plugin.tools).find(item => item.name === 'computer_observe');
assert.deepEqual(outgoing.parameters, tool('computer_observe').inputJsonSchema, 'Provider discarded the bundled tool schema');
let fixture;
let directory;
try {
  const result = await status.handler({}, context);
  assert.equal(result.protocolVersion, 4);
  assert.equal(result.architecture, 'x64');
  assert.equal(result.platform, 'win32');
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
    let window;
    for (let attempt = 0; attempt < 40; attempt++) {
      window = (await call('computer_windows', {})).find(item => item.pid === fixture.pid);
      if (window) break;
      await delay(100);
    }
    assert.ok(window, 'Fixture window not discovered');
    const observe = () => call('computer_observe', { windowId: window.windowId, root: null, filter: null });
    let observation = await observe();
    const field = observation.elements.find(item => item.controlType === 50004 && !item.protected);
    assert.ok(field, 'Editor missing after initial null-root observation');
    await call('computer_focus', { windowId: window.windowId });
    observation = await observe();
    const currentField = observation.elements.find(item => item.controlType === 50004 && !item.protected);
    assert.ok(currentField, 'Editor missing after focus');
    await call('computer_click', { windowId: window.windowId, observationId: observation.observationId, elementId: currentField.elementId });
    observation = await observe();
    const expected = 'Zażółć gęślą jaźń.\nTo jest test Moxxy na Windowsie.\nTrzecia linia: ✅';
    await call('computer_type', { windowId: window.windowId, observationId: observation.observationId, elementId: observation.focusedElementId, text: expected });
    await delay(200);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.text.replaceAll('\r', ''), expected, 'Installed plugin wrote incorrect text');
    const capture = await call('computer_screenshot', { windowId: window.windowId, region: null });
    assert.ok(capture.base64.length > 0 && capture.forModel.includes(capture.captureId));
    console.log('passed: installed model-facing schema -> null options -> observe -> click -> type -> real fixture text -> screenshot');
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
