import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, defineProvider } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';

/**
 * Regression: `moxxy doctor` boots a full session for diagnostics and must
 * drain persistence + close the session before returning — otherwise its boot
 * daemons keep the process alive and the final index row may not reach disk.
 *
 * A REAL bare Session + REAL SessionPersistence (temp dir) backs the
 * "session closed + last event on disk after the command returns" assertions;
 * the diagnostic registries are empty on a bare session, so every check
 * resolves trivially. Only the heavy externals (`setupSessionWithConfig`,
 * voice-capture probe) are mocked.
 */

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-doctor-lifecycle-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const core = await vi.importActual<typeof import('@moxxy/core')>('@moxxy/core');

let harness: {
  session: import('@moxxy/core').Session;
  persistence: import('@moxxy/core').SessionPersistence;
  onShutdown: ReturnType<typeof vi.fn>;
  dir: string;
  id: string;
};

vi.mock('@moxxy/plugin-cli', () => ({
  checkVoiceCaptureAvailable: async () => ({ ready: true, issues: [] }),
}));

vi.mock('../setup.js', () => ({
  setupSessionWithConfig: vi.fn(async () => ({
    session: harness.session,
    persistence: harness.persistence,
    config: {},
    configSources: [],
    vault: {
      open: async () => undefined,
      sourceName: 'env',
      get: async () => null,
    },
    memory: { list: async () => [] },
    pluginRegistration: { registered: new Set<string>(), skipped: [] },
  })),
}));

const { runDoctorCommand } = await import('./doctor.js');

function argv(): ParsedArgv {
  return { positional: [], flags: { json: true } } as unknown as ParsedArgv;
}

describe('runDoctorCommand lifecycle', () => {
  beforeEach(async () => {
    const dir = await makeTempDir();
    const session = new core.Session({ cwd: os.tmpdir(), logger: core.silentLogger });
    const id = String(session.id);
    const persistence = new core.SessionPersistence({
      sessionId: session.id,
      cwd: os.tmpdir(),
      dir,
    });
    const detach = persistence.attach(session.log);
    const onShutdown = vi.fn();
    // Register the default-checked provider so its doctor row is a `warn`
    // (no key in the fake vault) rather than a `fail` (not registered) — the
    // lifecycle assertions want a clean exit code, not a green setup.
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@test/anthropic',
        providers: [
          defineProvider({
            name: 'anthropic',
            models: [],
            createClient: () => ({
              name: 'anthropic',
              models: [],
              stream: async function* () {},
              countTokens: async () => 0,
            }),
          }),
        ],
      }),
    );
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@test/persistence-handle',
        hooks: { onShutdown: async () => detach() },
      }),
    );
    session.pluginHost.registerStatic(
      definePlugin({ name: '@test/close-spy', hooks: { onShutdown } }),
    );
    // Simulate the "last event" a prior turn would have left in this resumed
    // session's log, so the drain assertion has something to observe on disk.
    await session.log.append({
      type: 'user_prompt',
      sessionId: session.id,
      turnId: 't1' as never,
      source: 'user',
      text: 'last event before doctor ran',
    });
    harness = { session, persistence, onShutdown, dir, id };
  });

  it('closes the session and leaves the last event on disk after returning', async () => {
    const code = await runDoctorCommand(argv());
    // Bare session has no failing checks.
    expect(code).toBe(0);

    // (a) session closed — onShutdown fired exactly once.
    expect(harness.onShutdown).toHaveBeenCalledTimes(1);

    // (b) drain happened: the last appended event survived to disk.
    const restored = await core.restoreSessionEvents(harness.id, harness.dir);
    expect(restored.at(-1)).toMatchObject({ text: 'last event before doctor ran' });
  });
});
