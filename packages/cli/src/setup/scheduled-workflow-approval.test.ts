import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { Session } from '@moxxy/core';
import { asToolCallId, definePlugin, defineTool, z } from '@moxxy/sdk';
import { WorkflowStore, parseWorkflowYaml } from '@moxxy/plugin-workflows';
import { buildWorkflowRunner } from './build-workflow-runner.js';
import { buildWorkflowApprovalExecution } from './workflow-approval-scope.js';
import { buildSchedulerRunner } from './scheduler-runner.js';

it('runs the scheduled DAG without an extra model turn, but still waits before the real file write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-real-'));
  const store = new WorkflowStore({ cwd: dir, userDir: join(dir, 'user'), projectDir: join(dir, 'project') });
  const parsed = parseWorkflowYaml('name: exact-write\ndescription: approval test\ndelivery:\n  inbox: false\nsteps:\n  - id: write\n    tool: fixture_write\n    args:\n      text: approved\n');
  if (!parsed.workflow) throw new Error(parsed.errors.join(';'));
  await store.create(parsed.workflow, 'project');
  const session = new Session({ cwd: dir, silent: true });
  session.pluginHost.registerStatic(definePlugin({ name: 'real-write-fixture', tools: [
    defineTool({ name: 'fixture_write', inputSchema: z.object({ text: z.string() }),
      permission: { action: 'prompt' }, handler: async ({ text }) => { await writeFile(join(dir, 'result.txt'), text); return text; } }),
  ] }));
  const { approvals, execution } = buildWorkflowApprovalExecution(dir, store, join(dir, 'approvals'));
  const runner = buildWorkflowRunner({ session, store, approvalExecution: execution, recordDir: join(dir, 'records') });
  session.services.register('workflowRunner', runner);
  const result = buildSchedulerRunner(session).runPrompt({ prompt: 'Do not send this to a model', scheduleName: 'exact-write', origin: { kind: 'workflow', name: 'exact-write' } });
  try {
    let pending = await approvals.list();
    for (let i = 0; !pending.length && i < 100; i++) { await delay(5); pending = await approvals.list(); }
    expect(pending).toHaveLength(1);
    await expect(readFile(join(dir, 'result.txt'), 'utf8')).rejects.toThrow();
    const first = pending[0]; if (!first) throw new Error('No approval');
    await approvals.decide(first.id, 'allow_once');
    await expect(result).resolves.toEqual({ text: 'approved' });
    expect(await readFile(join(dir, 'result.txt'), 'utf8')).toBe('approved');
    expect(session.log.ofType('provider_request')).toHaveLength(0);
    expect(session.log.ofType('tool_call_approved')).toHaveLength(1);
  } finally { session.abort(); await result; await session.close(); await rm(dir, { recursive: true, force: true }); }
});

it('invalidates an outstanding approval when the workflow file is edited outside the app', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-external-edit-'));
  const store = new WorkflowStore({ cwd: dir, userDir: join(dir, 'user'), projectDir: join(dir, 'project') });
  const yaml = 'name: editable\ndescription: test\nsteps:\n  - id: first\n    prompt: Original prompt\n';
  const parsed = parseWorkflowYaml(yaml); if (!parsed.workflow) throw new Error('Invalid fixture');
  const entry = await store.create(parsed.workflow, 'project');
  const session = new Session({ cwd: dir, silent: true });
  const { approvals, execution } = buildWorkflowApprovalExecution(dir, store, join(dir, 'approvals'));
  const task = execution.run('editable', 'run1', session.signal, () => session.resolver.check(
    { callId: asToolCallId('test'), name: 'Write', input: {} }, { sessionId: String(session.id) }));
  try {
    let requests = await approvals.list();
    for (let i = 0; !requests.length && i < 100; i++) { await delay(5); requests = await approvals.list(); }
    expect(requests).toHaveLength(1);
    await writeFile(entry.path, yaml.replace('Original prompt', 'Changed prompt'));
    const result = await Promise.race([task, delay(750).then(() => null)]);
    expect(result).toMatchObject({ mode: 'deny' });
  } finally { session.abort(); await task; await session.close(); await rm(dir, { recursive: true, force: true }); }
});

it('propagates workflow Stop to a nested execution even when its caller passes the original signal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-nested-stop-'));
  const store = new WorkflowStore({ cwd: dir, userDir: join(dir, 'user'), projectDir: join(dir, 'project') });
  const parsed = parseWorkflowYaml('name: nested-stop\ndescription: test\nsteps:\n  - id: first\n    prompt: test\n');
  if (!parsed.workflow) throw new Error('Invalid fixture');
  await store.create(parsed.workflow, 'project');
  const { execution } = buildWorkflowApprovalExecution(dir, store, join(dir, 'approvals'));
  const original = new AbortController();
  let nestedSignal: AbortSignal | undefined;
  try {
    await execution.run('nested-stop', 'outer', original.signal, async () => {
      await execution.run('nested-stop', 'inner', original.signal, async signal => { nestedSignal = signal; });
    });
    expect(nestedSignal?.aborted).toBe(true);
    expect(original.signal.aborted).toBe(false);
  } finally { original.abort(); await rm(dir, { recursive: true, force: true }); }
});

it('rejects a cached or resumed definition instead of authorizing it under the updated definition revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-stale-definition-'));
  const store = new WorkflowStore({ cwd: dir, userDir: join(dir, 'user'), projectDir: join(dir, 'project') });
  const yaml = 'name: cached\ndescription: test\nsteps:\n  - id: first\n    prompt: Original prompt\n';
  const parsed = parseWorkflowYaml(yaml); if (!parsed.workflow) throw new Error('Invalid fixture');
  const entry = await store.create(parsed.workflow, 'project');
  const { execution } = buildWorkflowApprovalExecution(dir, store, join(dir, 'approvals'));
  let ran = false;
  try {
    await writeFile(entry.path, yaml.replace('Original prompt', 'Changed prompt'));
    await expect(execution.run('cached', 'run', new AbortController().signal,
      async () => { ran = true; }, parsed.workflow)).rejects.toThrow(/definition changed/i);
    expect(ran).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
