import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';

/**
 * Regression: `moxxy -p` must drain persistence + close the session before it
 * returns, so the process exits promptly without dropping the last event.
 *
 * We boot a REAL Session wired to a REAL SessionPersistence (temp dir) so the
 * "last event is on disk after the command returns" assertion is genuine, and
 * mock only `setupSessionWithConfig` (to hand that session back) and `runTurn`
 * (to append the final event the way a real turn would).
 */

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-prompt-lifecycle-'));
  tempDirs.push(dir);
  return dir;
}
// Pretend stdin is a TTY so `readStdinIfPiped()` short-circuits instead of
// draining a never-ending stream under the test runner.
const realIsTTY = process.stdin.isTTY;
afterEach(async () => {
  vi.restoreAllMocks();
  process.stdin.isTTY = realIsTTY;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const core = await vi.importActual<typeof import('@moxxy/core')>('@moxxy/core');

// Built per-test in beforeEach.
let harness: {
  session: import('@moxxy/core').Session;
  persistence: import('@moxxy/core').SessionPersistence;
  onShutdown: ReturnType<typeof vi.fn>;
  dir: string;
  id: string;
};

// Swappable per-test turn behavior. Default appends one final event + yields it.
let runTurnImpl: (session: import('@moxxy/core').Session) => AsyncGenerator<unknown>;

vi.mock('@moxxy/core', async () => {
  const actual = await vi.importActual<typeof import('@moxxy/core')>('@moxxy/core');
  return {
    ...actual,
    runTurn: (session: import('@moxxy/core').Session) => runTurnImpl(session),
  };
});

vi.mock('../setup.js', () => ({
  setupSessionWithConfig: vi.fn(async () => ({
    session: harness.session,
    persistence: harness.persistence,
  })),
}));

const { runPromptCommand } = await import('./prompt.js');

function argv(): ParsedArgv {
  return { positional: [], flags: { p: 'hello', 'output-format': 'stream-json' } } as unknown as ParsedArgv;
}

describe('runPromptCommand lifecycle', () => {
  beforeEach(async () => {
    process.stdin.isTTY = true;
    runTurnImpl = async function* (session) {
      const event = await session.log.append({
        type: 'user_prompt',
        sessionId: session.id,
        turnId: 't1' as never,
        source: 'user',
        text: 'last event from the turn',
      });
      yield event;
    };
    const dir = await makeTempDir();
    const session = new core.Session({ cwd: os.tmpdir(), logger: core.silentLogger });
    const id = String(session.id);
    const persistence = new core.SessionPersistence({ sessionId: session.id, cwd: os.tmpdir(), dir });
    const detach = persistence.attach(session.log);
    const onShutdown = vi.fn();
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@test/persistence-handle',
        hooks: { onShutdown: async () => detach() },
      }),
    );
    session.pluginHost.registerStatic(
      definePlugin({ name: '@test/close-spy', hooks: { onShutdown } }),
    );
    harness = { session, persistence, onShutdown, dir, id };
  });

  it('closes the session and leaves the last event on disk after returning', async () => {
    const code = await runPromptCommand(argv());
    expect(code).toBe(0);

    // (a) session closed — onShutdown fired.
    expect(harness.onShutdown).toHaveBeenCalledTimes(1);

    // (b) the drain happened: the last appended event is durably on disk.
    const restored = await core.restoreSessionEvents(harness.id, harness.dir);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ type: 'user_prompt', text: 'last event from the turn' });
  });

  it('still closes the session (and drains) when the turn throws — exit code 1', async () => {
    runTurnImpl = async function* (session) {
      // Append the last event first so the drain assertion is meaningful, then
      // blow up mid-stream.
      yield await session.log.append({
        type: 'user_prompt',
        sessionId: session.id,
        turnId: 't1' as never,
        source: 'user',
        text: 'last before crash',
      });
      throw new Error('provider exploded');
    };

    const code = await runPromptCommand(argv());
    expect(code).toBe(1);
    expect(harness.onShutdown).toHaveBeenCalledTimes(1);
    const restored = await core.restoreSessionEvents(harness.id, harness.dir);
    expect(restored.at(-1)).toMatchObject({ text: 'last before crash' });
  });
});
