import assert from 'node:assert/strict';
import test from 'node:test';
import { Session, PermissionEngine } from '../packages/core/dist/index.js';
import { asTurnId, dispatchToolCall } from '../packages/sdk/dist/index.js';
import { createComputerControlPlugin } from '../packages/plugin-computer-control/dist/index.js';

test('real session policy denies every Windows computer tool before execution', async () => {
  const session = new Session({
    cwd: process.cwd(), silent: true,
    permissionEngine: new PermissionEngine({ allow: [], deny: [{ name: 'computer_*', reason: 'Computer Use prohibited by test policy' }] }),
  });
  const plugin = createComputerControlPlugin('win32', 'x64');
  session.pluginHost.registerStatic(plugin);
  const context = {
    ...session.appContext(), turnId: asTurnId('computer-policy-test'),
    hooks: session.dispatcher, permissions: session.resolver, tools: session.tools,
    signal: new AbortController().signal, emit: (event) => session.log.append(event),
  };
  try {
    for (const tool of plugin.tools) {
      const events = [];
      for await (const event of dispatchToolCall(context, { id: tool.name, name: tool.name, input: {} }, 0)) events.push(event);
      assert.ok(!events.some((event) => event.type === 'tool_call_approved'));
      const result = events.find((event) => event.type === 'tool_result');
      assert.equal(result?.ok, false);
      assert.equal(result?.error?.kind, 'denied');
      assert.match(result.error.message, /prohibited by test policy/);
    }
  } finally { await session.close(); }
});
