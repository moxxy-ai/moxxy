import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { Session, createSubagentSpawner, createWorkflowToolRunner } from '@moxxy/core';
import { asToolCallId, definePlugin, defineTool, z } from '@moxxy/sdk';
import { WorkflowStore, WorkflowRunStore, resumeWorkflowRun, parseWorkflowYaml, buildWorkflowsCommand } from '@moxxy/plugin-workflows';
import { buildWorkflowRunner } from './build-workflow-runner.js';
import { buildWorkflowApprovalExecution } from './workflow-approval-scope.js';
import { buildSchedulerRunner } from './scheduler-runner.js';
import { ScheduleStore } from '@moxxy/plugin-scheduler';
import { runSchedule } from '@moxxy/plugin-scheduler';

it('cancels a resumed checkpoint before invoking a child and removes its resumable state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-resume-stop-'));
  const session = new Session({ cwd: dir, silent: true });
  const controller = new AbortController();
  const parsed = parseWorkflowYaml('name: paused-stop\ndescription: test\nsteps:\n  - id: ask\n    prompt: Ask a question\n    awaitInput: true\n');
  if (!parsed.workflow) throw new Error('Invalid fixture');
  const store = new WorkflowRunStore(join(dir, 'checkpoints'));
  const runId = await store.save({ workflow: parsed.workflow, trigger: 'manual', inputs: {},
    states: { ask: { status: 'awaiting_input', output: 'Question?', startedAt: 1, endedAt: 2 } },
    pendingStepId: 'ask', interactionAgentId: 'never-created-child', startedAt: 1 });
  const turnId = session.startTurn().turnId;
  const spawner = createSubagentSpawner({ parentSession: session, parentTurnId: turnId, parentSignal: controller.signal, parentModel: 'unused' });
  const events: string[] = [];
  controller.abort('Stopped by user');
  try {
    const result = await resumeWorkflowRun(runId, 'Reply', { spawner,
      tools: createWorkflowToolRunner(session, turnId, spawner),
      lookup: { skill: name => session.skills.byName(name), workflow: () => parsed.workflow },
      signal: controller.signal, emit: subtype => { events.push(subtype); },
    }, store);
    expect(result.status).toBe('cancelled');
    expect(result.steps[0]?.status).toBe('cancelled');
    expect(events).toContain('workflow_cancelled');
    expect(events).not.toContain('workflow_step_failed');
    expect(await store.load(runId)).toBeNull();
    expect(session.log.ofType('provider_request')).toHaveLength(0);
  } finally { await session.close(); await rm(dir, { recursive: true, force: true }); }
});

it.each(['stop', 'deny'] as const)('reports %s distinctly while preserving the denied file and not starting downstream steps', async decision => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-stop-result-'));
  const store = new WorkflowStore({ cwd: dir, userDir: join(dir, 'user'), projectDir: join(dir, 'project') });
  const parsed = parseWorkflowYaml('name: stoppable\ndescription: test\ndelivery:\n  inbox: false\nsteps:\n  - id: write\n    tool: fixture_write\n  - id: next\n    needs: [write]\n    tool: fixture_write\n');
  if (!parsed.workflow) throw new Error('Invalid fixture');
  await store.create(parsed.workflow, 'project');
  const session = new Session({ cwd: dir, silent: true });
  session.pluginHost.registerStatic(definePlugin({ name: 'stop-fixture', tools: [
    defineTool({ name: 'fixture_write', inputSchema: z.object({}), permission: { action: 'prompt' },
      handler: async () => { await writeFile(join(dir, 'result.txt'), 'must not execute'); return 'written'; } }),
  ] }));
  const { approvals, execution } = buildWorkflowApprovalExecution(dir, store, join(dir, 'approvals'));
  const runner = buildWorkflowRunner({ session, store, approvalExecution: execution, recordDir: join(dir, 'records') });
  const task = runner.runNow({ name: 'stoppable', trigger: 'manual' });
  try {
    let requests = await approvals.list();
    for (let i = 0; !requests.length && i < 100; i++) { await delay(5); requests = await approvals.list(); }
    const request = requests[0]; if (!request) throw new Error('Missing approval request');
    if (decision === 'stop') await approvals.cancel(request.id);
    else await approvals.decide(request.id, 'deny');
    const result = await task;
    expect(result.status).toBe(decision === 'stop' ? 'cancelled' : 'failed');
    expect(result.ok).toBe(false);
    expect(result.steps.map(step => step.status)).toEqual([decision === 'stop' ? 'cancelled' : 'failed', 'skipped']);
    await expect(readFile(join(dir, 'result.txt'))).rejects.toThrow();
    const events = session.log.ofType('plugin_event').map(event => event.subtype);
    expect(events).toContain(decision === 'stop' ? 'workflow_cancelled' : 'workflow_failed');
    expect(events).not.toContain(decision === 'stop' ? 'workflow_failed' : 'workflow_cancelled');
    const [record] = await readdir(join(dir, 'records')); if (!record) throw new Error('Missing run record');
    const [header] = (await readFile(join(dir, 'records', record), 'utf8')).split('\n');
    if (!header) throw new Error('Missing run header');
    expect(JSON.parse(header).status).toBe(result.status);
    const command = buildWorkflowsCommand({ store, runRecordDir: join(dir, 'records') });
    const summary = await command.handler({ channel: 'tui', sessionId: session.id, session: {}, args: 'inspect stoppable' });
    if (summary.kind !== 'text') throw new Error('Missing summary');
    if (decision === 'stop') expect(summary.text).toContain('stopped');
  } finally { session.abort(); await task; await session.close(); await rm(dir, { recursive: true, force: true }); }
});

it('persists a stopped cron as cancelled across restart, not success or error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-cron-stop-'));
  const store = new WorkflowStore({ cwd: dir, userDir: join(dir, 'user'), projectDir: join(dir, 'project') });
  const parsed = parseWorkflowYaml('name: scheduled-stop\ndescription: test\ndelivery:\n  inbox: false\nsteps:\n  - id: write\n    tool: fixture_write\n');
  if (!parsed.workflow) throw new Error('Invalid fixture');
  await store.create(parsed.workflow, 'project');
  const session = new Session({ cwd: dir, silent: true });
  session.pluginHost.registerStatic(definePlugin({ name: 'cron-stop-fixture', tools: [
    defineTool({ name: 'fixture_write', inputSchema: z.object({}), permission: { action: 'prompt' },
      handler: async () => { await writeFile(join(dir, 'result.txt'), 'unwanted'); return 'written'; } }),
  ] }));
  const { approvals, execution } = buildWorkflowApprovalExecution(dir, store, join(dir, 'approvals'));
  session.services.register('workflowRunner', buildWorkflowRunner({ session, store, approvalExecution: execution, recordDir: join(dir, 'records') }));
  const file = join(dir, 'schedules.json'), schedules = new ScheduleStore({ file });
  await schedules.syncWorkflowSchedule('scheduled-stop', { id: '', name: 'scheduled-stop', workflowName: 'scheduled-stop', source: 'workflow', prompt: 'Run scheduled-stop', enabled: true, createdAt: 0, cron: '0 12 * * *' });
  const [entry] = await schedules.list(); if (!entry) throw new Error('Missing schedule');
  const task = runSchedule(entry, buildSchedulerRunner(session), schedules, { dir: join(dir, 'inbox') });
  try {
    let requests = await approvals.list();
    for (let i = 0; !requests.length && i < 100; i++) { await delay(5); requests = await approvals.list(); }
    const request = requests[0]; if (!request) throw new Error('Missing approval');
    await approvals.cancel(request.id);
    const result = await task;
    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(await new ScheduleStore({ file }).get(entry.id)).toMatchObject({ lastResult: 'cancelled' });
    if (!result.inboxPath) throw new Error('Missing inbox record');
    expect(await readFile(result.inboxPath, 'utf8')).toContain('outcome: cancelled');
    await expect(readFile(join(dir, 'result.txt'))).rejects.toThrow();
  } finally { session.abort(); await task; await session.close(); await rm(dir, { recursive: true, force: true }); }
});

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

it.each(['edited', 'deleted'])('invalidates an outstanding approval when the workflow file is %s outside the app', async change => {
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
    if (change === 'deleted') await store.delete('editable');
    else await writeFile(entry.path, yaml.replace('Original prompt', 'Changed prompt'));
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
