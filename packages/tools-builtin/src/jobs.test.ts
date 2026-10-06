import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { asSessionId, asToolCallId, asTurnId, invariant } from '@moxxy/sdk';
import type { AppContext, ToolContext } from '@moxxy/sdk';
import { bashTool } from './bash.js';
import { stopJobTool } from './stop-job.js';
import { waitTool } from './wait.js';
import { builtinToolsPlugin } from './index.js';
import { systemShell } from './shell.js';

// These commands are sh; they run wherever the Bash tool's shell speaks it (Git Bash on Windows).
const shCommands = systemShell().kind !== 'powershell';

/** A process that ended can linger a moment as a zombie until its new parent reaps it; it has ended all the same. */
function hasEnded(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  if (process.platform === 'win32') return false;
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return state === '' || state.startsWith('Z');
}

const ctx = (sessionId = 'jobs-session', signal = new AbortController().signal): ToolContext => ({
  sessionId: asSessionId(sessionId),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: os.tmpdir(),
  signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

const shutdown = (sessionId: string) =>
  builtinToolsPlugin.hooks?.onShutdown?.({ sessionId: asSessionId(sessionId) } as AppContext);

afterEach(async () => {
  await shutdown('jobs-session');
  await shutdown('other-session');
});

async function startJob(command: string, sessionId = 'jobs-session'): Promise<string> {
  const started = String(await bashTool.handler({ command, background: true, timeoutMs: 120_000 }, ctx(sessionId)));
  const id = /job (bg-\d+)/u.exec(started)?.[1];
  invariant(id !== undefined, `no job id in: ${started}`);
  return id;
}

const wait = (input: { jobId?: string; until?: string; timeoutSeconds?: number }, c = ctx()) =>
  waitTool.handler({ timeoutSeconds: 60, ...input }, c).then(String);

describe('background jobs', () => {
  it('Bash with background returns a job id at once while the command keeps running', async () => {
    const startedAt = Date.now();
    const out = String(await bashTool.handler({ command: 'sleep 20', background: true, timeoutMs: 120_000 }, ctx()));

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(out).toMatch(/Started background job bg-\d+/u);
    expect(out).toContain('Wait');
  });

  it.skipIf(!shCommands)('Wait wakes the moment the job exits instead of sleeping out its timeout', async () => {
    const id = await startJob('sleep 0.3; echo built');
    const startedAt = Date.now();

    const out = await wait({ jobId: id, timeoutSeconds: 60 });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(out).toContain(`job ${id} exited with code 0`);
    expect(out).toContain('built');
  });

  it.skipIf(!shCommands)('Wait with until returns as soon as the job prints the expected line', async () => {
    const id = await startJob('echo booting; sleep 0.2; echo "server ready on 3000"; sleep 30');
    const startedAt = Date.now();

    const out = await wait({ jobId: id, until: 'ready on \\d+' });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(out).toContain(`job ${id} printed /ready on \\d+/ and is still running`);
    expect(out).toContain('server ready on 3000');
  });

  it.skipIf(!shCommands)('a deadline reports the job as still running, not as an error', async () => {
    const id = await startJob('sleep 30');

    const out = await wait({ jobId: id, timeoutSeconds: 0.2 });

    expect(out).toContain(`job ${id} is still running`);
  });

  it.skipIf(!shCommands)('each Wait shows only the output printed since the previous one', async () => {
    const id = await startJob('echo first; sleep 0.3; echo second; sleep 30');
    await wait({ jobId: id, until: 'first' });

    const out = await wait({ jobId: id, until: 'second' });

    expect(out).toContain('second');
    expect(out).not.toContain('first');
  });

  it.skipIf(!shCommands)('Wait without a job id wakes on whichever running job finishes first', async () => {
    const slow = await startJob('sleep 30');
    const fast = await startJob('sleep 0.2; echo quick');

    const out = await wait({});

    expect(out).toContain(`job ${fast} exited with code 0`);
    expect(out).not.toContain(`job ${slow}`);
  });

  // Real models fill optional fields with placeholders (`until: ".*"`,
  // `jobId: " "`); those must mean "not given", not "wake at once".
  it.skipIf(!shCommands)('treats an until pattern that matches empty output as not given', async () => {
    const id = await startJob('sleep 0.3; echo built');

    const out = await wait({ jobId: id, until: '.*' });

    expect(out).toContain(`job ${id} exited with code 0`);
    expect(out).toContain('built');
  });

  it.skipIf(!shCommands)('treats a blank until as not given', async () => {
    const id = await startJob('echo "first line"; sleep 0.3; echo built');

    await expect(wait({ jobId: id, until: ' ' })).resolves.toContain(`job ${id} exited with code 0`);
  });

  it.skipIf(!shCommands)('treats a blank job id as "any running job"', async () => {
    const id = await startJob('sleep 0.2; echo quick');

    await expect(wait({ jobId: ' ' })).resolves.toContain(`job ${id} exited with code 0`);
  });

  it('says so when there is nothing to wait for', async () => {
    await expect(wait({})).resolves.toContain('No background jobs are running');
  });

  it('keeps one session’s jobs out of another session', async () => {
    const id = await startJob('sleep 30', 'other-session');

    await expect(wait({ jobId: id })).rejects.toThrow(/No background job/u);
  });

  it.skipIf(!shCommands)('stopping the turn ends the Wait but leaves the job running', async () => {
    const id = await startJob('sleep 30');
    const turn = new AbortController();
    const waiting = wait({ jobId: id }, ctx('jobs-session', turn.signal));

    turn.abort();

    await expect(waiting).rejects.toThrow(/interrupted/u);
    await expect(wait({ jobId: id, timeoutSeconds: 0.1 })).resolves.toContain('is still running');
  });

  it.skipIf(!shCommands)('StopJob ends the job and reports its last output', async () => {
    const id = await startJob('echo working; sleep 30');
    await wait({ jobId: id, until: 'working' });

    const out = String(await stopJobTool.handler({ jobId: id }, ctx()));

    expect(out).toContain(`job ${id} stopped`);
    await expect(wait({ jobId: id })).resolves.toContain(`job ${id} stopped`);
  });

  // sh, Git Bash and PowerShell all read this line the same way (no double quotes:
  // Windows PowerShell drops them on the way to a program). `echo after` keeps the
  // shell from replacing itself with node, so node is a grandchild of the job.
  it('StopJob ends every process the job started, not only its shell', async () => {
    const id = await startJob("node -e 'console.log(`pid ${process.pid}`); setInterval(() => {}, 1000)'; echo after");
    const pid = Number(/pid (\d+)/u.exec(await wait({ jobId: id, until: 'pid \\d+' }))?.[1]);
    expect(hasEnded(pid)).toBe(false);

    await stopJobTool.handler({ jobId: id }, ctx());

    expect(hasEnded(pid)).toBe(true);
  });

  it('closing the session stops the jobs it started', async () => {
    const id = await startJob('sleep 30');

    await shutdown('jobs-session');

    await expect(wait({ jobId: id })).rejects.toThrow(/No background job/u);
  });
});
