import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { claimWorkflowLease } from './workflow-lease.js';

it('allows exactly one concurrent execution and releases the identity for the next run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-lease-'));
  try {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => claimWorkflowLease(dir, 'same-workflow', new AbortController().signal)));
    const winners = attempts.filter(item => item.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const winner = winners[0]; if (!winner || winner.status !== 'fulfilled') throw new Error('No lease');
    await winner.value();
    const release = await claimWorkflowLease(dir, 'same-workflow', new AbortController().signal);
    await release();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('excludes real competing processes and recovers after the owning process dies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-lease-process-'));
  const children: ChildProcess[] = [];
  const moduleUrl = new URL('../../dist/permissions/workflow-lease.js', import.meta.url).href;
  const code = `
    const { claimWorkflowLease } = await import(process.env.LEASE_MODULE);
    try {
      const release = await claimWorkflowLease(process.env.LEASE_DIRECTORY, 'shared', new AbortController().signal);
      process.send('owned');
      process.once('message', async () => { await release(); process.disconnect(); });
    } catch { process.send('busy'); process.disconnect(); }
  `;
  try {
    const results = await Promise.all(Array.from({ length: 6 }, async () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, LEASE_MODULE: moduleUrl, LEASE_DIRECTORY: dir }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      children.push(child);
      const [result] = await once(child, 'message');
      return { child, result };
    }));
    const owners = results.filter(item => item.result === 'owned');
    expect(owners).toHaveLength(1);
    const owner = owners[0]; if (!owner) throw new Error('No owner');
    const exited = once(owner.child, 'exit'); owner.child.kill(); await exited;
    const release = await claimWorkflowLease(dir, 'shared', new AbortController().signal);
    await release();
  } finally {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit'); child.kill(); await exited;
    }));
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
