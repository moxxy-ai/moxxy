import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { definePlugin, defineTool, z } from '@moxxy/sdk';
import { Session } from './session.js';
import { PermissionEngine } from './permissions/engine.js';
import { createWorkflowToolRunner } from './workflow-tool-runner.js';
import { withPermissionScope } from './permissions/scope.js';

it('gates real workflow tool execution with policy, hooks and paired events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-workflow-policy-'));
  const session = new Session({ cwd: dir, silent: true,
    permissionEngine: new PermissionEngine(undefined, join(dir, 'permissions.json')),
    permissionResolver: { name: 'test-deny', check: async () => ({ mode: 'deny' }) },
  });
  const effects: string[] = [];
  session.pluginHost.registerStatic(definePlugin({ name: 'workflow-gate-fixture', tools: [
    defineTool({ name: 'append', inputSchema: z.object({ text: z.string() }),
      permission: { action: 'prompt' }, handler: ({ text }) => { effects.push(text); return text; } }),
  ] }));
  try {
    const turnId = session.startTurn().turnId;
    const runner = createWorkflowToolRunner(session, turnId);
    await expect(runner.execute('append', { text: 'denied' }, session.signal)).rejects.toThrow(/denied/i);
    expect(effects).toEqual([]);
    let permissionTurn: string | undefined;
    session.setPermissionResolver({ name: 'test-allow', check: async (_call, context) => {
      permissionTurn = context.turnId;
      return { mode: 'allow' };
    } });
    session.pluginHost.registerStatic(definePlugin({ name: 'workflow-rewrite-fixture',
      hooks: { onToolCall: () => ({ action: 'rewrite', input: { text: 'rewritten' } }) },
    }));
    await expect(runner.execute('append', { text: 'original' }, session.signal)).resolves.toBe('rewritten');
    expect(effects).toEqual(['rewritten']);
    expect(permissionTurn).toBe(String(turnId));
    await withPermissionScope({ name: 'workflow-deny', check: async () => ({ mode: 'deny' }) }, async () => {
      await expect(runner.execute('append', { text: 'scoped' }, session.signal)).rejects.toThrow(/denied/i);
    });
    expect(effects).toEqual(['rewritten']);
    const calls = session.log.ofType('tool_call_requested');
    expect(calls).toHaveLength(3);
    expect(session.log.ofType('tool_result').map(e => [e.callId, e.ok]))
      .toEqual(calls.map((e, i) => [e.callId, i === 1]));
    const abort = new AbortController(); abort.abort();
    await expect(runner.execute('append', { text: 'aborted' }, abort.signal)).rejects.toThrow(/abort/i);
    expect(effects).toEqual(['rewritten']);
  } finally { await session.close(); await rm(dir, { recursive: true, force: true }); }
});

it('does not execute after a pending approval is cancelled or policy changes', async () => {
  const session = new Session({ cwd: tmpdir(), silent: true });
  let executed = 0;
  session.pluginHost.registerStatic(definePlugin({ name: 'late-approval-fixture', tools: [
    defineTool({ name: 'effect', inputSchema: z.object({}), permission: { action: 'prompt' }, handler: () => ++executed }),
  ] }));
  const controller = new AbortController();
  session.setPermissionResolver({ name: 'late', check: async () => { controller.abort(); return { mode: 'allow' }; } });
  const runner = createWorkflowToolRunner(session, session.startTurn().turnId);
  try {
    await expect(runner.execute('effect', {}, controller.signal)).rejects.toThrow(/abort/i);
    expect(executed).toBe(0);
    session.setPermissionResolver({ name: 'policy-changes', check: async () => {
      await session.permissions.addDeny({ name: 'effect' }); return { mode: 'allow' };
    } });
    await expect(runner.execute('effect', {}, session.signal)).rejects.toThrow(/den/i);
    expect(executed).toBe(0);
  } finally { await session.close(); }
});

it('aborts in-flight work before shutdown hooks wait for it', async () => {
  const session = new Session({ cwd: tmpdir(), silent: true });
  let abortedWhenDisposing = false;
  session.pluginHost.registerStatic(definePlugin({ name: 'shutdown-order-fixture', hooks: {
    onShutdown: () => { abortedWhenDisposing = session.signal.aborted; },
  } }));
  await session.close();
  expect(abortedWhenDisposing).toBe(true);
});
