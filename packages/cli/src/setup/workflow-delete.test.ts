import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { ScheduleStore } from '@moxxy/plugin-scheduler';
import { buildWorkflowsIntegration } from './workflows.js';
import { startRunnerServer, connectRemoteSession } from '@moxxy/runner';
import { randomUUID } from 'node:crypto';

it('deleting a workflow through the view retires its cron and preserves other schedules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-delete-'));
  const oldHome = process.env.MOXXY_HOME;
  const oldUserHome = process.env.HOME;
  process.env.HOME = dir;
  process.env.MOXXY_HOME = join(dir, 'home');
  const definitions = join(dir, '.moxxy/workflows');
  await mkdir(definitions, { recursive: true });
  await writeFile(join(definitions, 'daily.yaml'), 'name: daily\ndescription: test\non:\n  schedule:\n    cron: "0 10 * * *"\nsteps:\n  - id: a\n    prompt: hello\n');
  const session = new Session({ cwd: dir, logger: silentLogger });
  const schedules = new ScheduleStore({ file: join(dir, 'schedules.json') });
  const manual = await schedules.create({ name: 'unrelated', prompt: 'keep', cron: '0 9 * * *' });
  const integration = buildWorkflowsIntegration({ session, scheduleStore: schedules });
  session.pluginHost.registerStatic(integration.plugin);
  const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\moxxy-delete-' + randomUUID() : join(dir, 'runner.sock');
  const server = await startRunnerServer(session, { socketPath });
  const remote = await connectRemoteSession({ socketPath });
  try {
    await session.dispatcher.dispatchInit(session.appContext());
    expect((await schedules.list()).some(s => s.workflowName === 'daily')).toBe(true);
    expect(session.workflows?.delete).toBeTypeOf('function');
    if (!session.workflows?.delete) throw new Error('Missing delete');
    await remote.workflows.delete('daily');
    expect((await session.workflows.list()).some(w => w.name === 'daily')).toBe(false);
    expect((await schedules.list()).some(s => s.workflowName === 'daily')).toBe(false);
    expect(await schedules.get(manual.id)).toMatchObject({ enabled: true, prompt: 'keep' });
    await schedules.syncWorkflowSchedule('daily', { id: '', name: 'wf-daily', source: 'workflow', workflowName: 'daily', prompt: 'stale runner', cron: '0 10 * * *', enabled: true, createdAt: 0 });
    expect((await schedules.list()).some(s => s.workflowName === 'daily')).toBe(false);
  } finally {
    integration.stop(); await remote.close(); await server.close(); await session.close();
    if (oldHome === undefined) delete process.env.MOXXY_HOME; else process.env.MOXXY_HOME = oldHome;
    if (oldUserHome === undefined) delete process.env.HOME; else process.env.HOME = oldUserHome;
    await rm(dir, { recursive: true, force: true });
  }
});
