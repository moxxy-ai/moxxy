import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { ScheduleStore } from './store.js';
import { SchedulerPoller, isDue } from './poller.js';
import { runSchedule } from './runner.js';

it('does not block other workflows behind an HTTP operation awaiting the operator', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-poller-'));
  let held: ServerResponse | undefined;
  const server = createServer((request, response) => {
    if (request.url === '/held') held = response; else response.end('finished');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP port');
  const store = new ScheduleStore({ file: join(dir, 'schedules.json') });
  const now = Date.now();
  const first = await store.create({ name: 'held', prompt: 'held', runAt: now - 1000, source: 'workflow', workflowName: 'held' });
  await store.create({ name: 'fast', prompt: 'fast', runAt: now - 1000, source: 'workflow', workflowName: 'fast' });
  const poller = new SchedulerPoller({ store, inbox: { dir: join(dir, 'inbox') }, runner: {
    runPrompt: async ({ prompt }) => ({ text: await (await fetch(`http://127.0.0.1:${address.port}/${prompt}`)).text() }),
  } });
  const tick = poller.tickOnce();
  try {
    expect(await Promise.race([tick, delay(500).then(() => 'blocked')])).toBe(2);
    const deadline = Date.now() + 3000;
    while (!(await store.list()).some(entry => entry.name === 'fast' && entry.lastResult === 'ok') && Date.now() < deadline) await delay(10);
    expect((await store.list()).find(entry => entry.name === 'fast')?.lastResult).toBe('ok');
    const waiting = await store.get(first.id); if (!waiting) throw new Error('Missing schedule');
    expect(isDue(waiting, Date.now())).toBe(false);
    await store.update(first.id, { cron: '* * * * *', createdAt: now - 120_000, lastStartedAt: now - 120_000 });
    await poller.tickOnce();
    expect((await store.get(first.id))?.lastSkipReason).toMatch(/still running or awaiting approval/);
  } finally {
    held?.end('released'); server.closeAllConnections(); await tick; await poller.stop();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    await rm(dir, { recursive: true, force: true });
  }
});

it('cancels the waiting workflow when another store disables its schedule', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-disable-'));
  const file = join(dir, 'schedules.json');
  const store = new ScheduleStore({ file });
  const editor = new ScheduleStore({ file });
  const entry = await store.create({ name: 'pending', prompt: 'pending', runAt: Date.now() - 1000, source: 'workflow', workflowName: 'pending' });
  let received: AbortSignal | undefined;
  let release: (() => void) | undefined;
  const run = runSchedule(entry, { runPrompt: async input => {
    received = input.signal;
    await new Promise<void>(resolve => {
      release = resolve;
      if (input.signal?.aborted) resolve(); else input.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    return { text: '', error: 'cancelled' };
  } }, store, { dir: join(dir, 'inbox') });
  try {
    const started = Date.now() + 3000;
    while (!release && Date.now() < started) await delay(10);
    await editor.update(entry.id, { enabled: false });
    const stopped = Date.now() + 3000;
    while (!received?.aborted && Date.now() < stopped) await delay(10);
    expect(received?.aborted).toBe(true);
  } finally { release?.(); await run; await rm(dir, { recursive: true, force: true }); }
});
