import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { startRunnerServer, type RunnerServer } from '@moxxy/runner';
import { asTurnId } from '@moxxy/sdk';
import { RunnerSupervisor } from './runner-supervisor';

// A REAL runner server on a temp socket stands in for a channel bot's runner —
// the supervisor, the socket and the runner protocol all run for real.
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tmpSocket(): string {
  return path.join(os.tmpdir(), `moxxy-attach-${Math.random().toString(36).slice(2, 10)}.sock`);
}

function botSession(): Session {
  return new Session({ cwd: process.cwd(), logger: silentLogger, permissionResolver: autoAllowResolver });
}

async function startBot(socketPath: string, session = botSession()): Promise<{ session: Session; server: RunnerServer }> {
  const server = await startRunnerServer(session, { socketPath });
  cleanups.push(() => server.close());
  return { session, server };
}

function attachOnly(socketPath: string): RunnerSupervisor {
  const supervisor = new RunnerSupervisor(socketPath, 'moxxy-channel-test', { attachOnly: true });
  void supervisor.run();
  cleanups.push(() => supervisor.stop());
  return supervisor;
}

async function waitFor(check: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('RunnerSupervisor attach-only (a channel bot runner)', () => {
  it('never starts a runner of its own while the bot is down, then attaches once it is up', async () => {
    const socketPath = tmpSocket();
    const supervisor = attachOnly(socketPath);

    await new Promise((r) => setTimeout(r, 300));
    expect(supervisor.snapshot().phase.phase).not.toBe('spawning');
    expect(supervisor.__childForTest()).toBeNull();
    expect(existsSync(socketPath)).toBe(false);

    const bot = await startBot(socketPath);
    await waitFor(() => supervisor.snapshot().phase.phase === 'connected');
    expect(supervisor.remote()?.getInfo().sessionId).toBe(bot.session.id);
  });

  it('starts a new conversation over the runner protocol and leaves the bot running', async () => {
    const socketPath = tmpSocket();
    const bot = await startBot(socketPath);
    await bot.session.log.append({ type: 'user_prompt', text: 'hello', sessionId: bot.session.id, turnId: asTurnId('t1'), source: 'user' } as never);
    expect(bot.session.log.length).toBe(1);
    const supervisor = attachOnly(socketPath);
    await waitFor(() => supervisor.snapshot().phase.phase === 'connected');

    await supervisor.resetSession();

    expect(bot.session.log.length).toBe(0);
    await waitFor(() => supervisor.snapshot().phase.phase === 'connected');
    expect(supervisor.remote()?.getInfo().sessionId).toBe(bot.session.id);
  });
});
