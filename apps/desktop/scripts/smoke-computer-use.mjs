import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
const context = { sessionId: randomUUID(), turnId: randomUUID(), signal: new AbortController().signal };
try {
  const result = await status.handler({}, context);
  assert.equal(result.protocolVersion, 1);
  assert.equal(result.architecture, 'x64');
  assert.equal(result.platform, 'win32');
  console.log('Installed Computer Use extension and native helper handshake passed');
} finally { await plugin.hooks.onShutdown(context); }
