/**
 * End-to-end runner test: a real {@link RunnerServer} over a real unix socket,
 * driven by a {@link RemoteSession} client. Exercises the whole stack -
 * handshake + history replay, streamed turns, and the bidirectional
 * permission prompt (server->client request).
 */
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Session,
  SessionPersistence,
  autoAllowResolver,
  restoreSessionEvents,
  silentLogger,
  type Logger,
} from '@moxxy/core';
import { loadActiveProvider, loadDisabledProviders } from '@moxxy/config';
import {
  asTurnId,
  defineMode,
  definePlugin,
  defineProvider,
  defineSurface,
  defineTool,
  defineTranscriber,
  z,
} from '@moxxy/sdk';
import type {
  AssistantMessageEvent,
  CommandOutput,
  SurfaceDataMessage,
  SurfaceInstance,
} from '@moxxy/sdk';
import { FakeProvider, streamingTextReply, textReply, toolUseReply } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { startRunnerServer, type RunnerServer } from './server.js';
import { connectRemoteSession, RemoteSession } from './remote-session.js';
import { connectUnixSocket } from './unix-socket.js';
import { JsonRpcPeer } from './jsonrpc.js';
import {
  RUNNER_PROTOCOL_VERSION,
  RunnerMethod,
  type SessionLoadHistoryResult,
} from './protocol.js';
import type { ProviderEvent } from '@moxxy/sdk';

function buildSession(provider: FakeProvider, logger: Logger = silentLogger): Session {
  const session = new Session({
    cwd: process.cwd(),
    logger,
    permissionResolver: autoAllowResolver,
  });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'runner-test-shim',
      providers: [
        defineProvider({
          name: provider.name,
          models: [...provider.models],
          createClient: () => provider,
        }),
      ],
      tools: [
        defineTool({
          name: 'echo',
          description: 'echo the input text',
          inputSchema: z.object({ text: z.string() }),
          permission: { action: 'prompt' },
          handler: (input) => input.text,
        }),
      ],
    }),
  );
  session.providers.setActive(provider.name);
  session.pluginHost.registerStatic(defaultModePlugin);
  return session;
}

function tmpSocket(): string {
  return path.join(os.tmpdir(), `moxxy-runner-${Math.random().toString(36).slice(2, 10)}.sock`);
}

/**
 * Register a controllable fake surface on a session and hand back a handle that
 * can PUSH frames (`emit`) and inspect what the host routed to it (input/resize/
 * close). The instance mirrors a real PTY surface: shared per kind, a snapshot
 * for late joiners, and an onData emitter the host multiplexes.
 */
function registerFakeSurface(session: Session, kind = 'terminal') {
  const subscribers = new Set<(payload: unknown) => void>();
  const state = { opens: 0, inputs: [] as unknown[], resizes: [] as unknown[], closed: 0 };
  session.pluginHost.registerStatic(
    definePlugin({
      name: `runner-test-surface-${kind}`,
      surfaces: [
        defineSurface({
          kind,
          description: 'fake test surface',
          open: () => {
            state.opens += 1;
            const instance: SurfaceInstance = {
              id: `${kind}-instance`,
              kind,
              onData: (cb) => {
                subscribers.add(cb);
                return () => subscribers.delete(cb);
              },
              snapshot: () => ({ scrollback: 'catch-up' }),
              input: (msg) => {
                state.inputs.push(msg);
              },
              resize: (size) => {
                state.resizes.push(size);
              },
              close: () => {
                state.closed += 1;
              },
            };
            return instance;
          },
        }),
      ],
    }),
  );
  return { state, emit: (payload: unknown) => subscribers.forEach((cb) => cb(payload)) };
}

/** Poll until `predicate` holds. Broadcast frames reach observers a tick after
 * the driver's own turn resolves, so observers need a moment to catch up. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Async-predicate variant of waitFor (persistence writes are queued + debounced). */
async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await predicate()) return;
    } catch {
      // e.g. the JSONL doesn't exist yet — keep polling
    }
    if (Date.now() > deadline) throw new Error('waitForAsync: condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const servers: RunnerServer[] = [];
const remotes: RemoteSession[] = [];

async function serve(provider: FakeProvider): Promise<{ session: Session; socketPath: string }> {
  const socketPath = tmpSocket();
  const session = buildSession(provider);
  const server = await startRunnerServer(session, { socketPath });
  servers.push(server);
  return { session, socketPath };
}

async function attach(socketPath: string, role = 'test'): Promise<RemoteSession> {
  const remote = await connectRemoteSession({ socketPath, role });
  remotes.push(remote);
  return remote;
}

afterEach(async () => {
  await Promise.all(remotes.splice(0).map((r) => r.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('runner end-to-end', () => {
  it('attach returns a snapshot that mirrors the session registries', async () => {
    const { session, socketPath } = await serve(new FakeProvider({ script: [textReply('hi')] }));
    const remote = await attach(socketPath);
    const info = remote.getInfo();
    expect(info.activeProvider).toBe('fake');
    expect(info.activeMode).toBe(session.getInfo().activeMode);
    expect(info.activeMode).toBeTruthy();
    expect(info.tools.map((t) => t.name)).toContain('echo');
    expect(info.cwd).toBe(process.cwd());
    expect(info.sessionId).toBe(session.id);
  });

  it('runTurn streams events and the assistant reply lands in the mirror', async () => {
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('hi from runner')] }));
    const remote = await attach(socketPath);
    const types: string[] = [];
    for await (const event of remote.runTurn('say hi')) types.push(event.type);
    expect(types).toContain('user_prompt');
    expect(types).toContain('assistant_message');
    const msg = remote.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(msg?.content).toContain('hi from runner');
  });

  it('replays history to a client that attaches after a turn', async () => {
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('first answer')] }));
    const a = await attach(socketPath, 'first');
    for await (const _event of a.runTurn('say hi')) void _event;

    const late = await attach(socketPath, 'late');
    expect(late.log.ofType('user_prompt').length).toBeGreaterThan(0);
    const msg = late.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(msg?.content).toContain('first answer');
  });

  it('replays full history even when a client attaches with sinceSeq>0', async () => {
    // Regression: the runner ignores sinceSeq and always replays from seq 0.
    // The client mirror's `ingest` only accepts contiguous seq from 0, so a
    // partial replay starting at sinceSeq>0 would drop every event and leave
    // the mirror permanently desynced. A late client must still see history and
    // stay in sync with subsequent broadcast events.
    const { socketPath } = await serve(
      new FakeProvider({ script: [textReply('first answer'), textReply('second answer')] }),
    );
    const a = await attach(socketPath, 'first');
    for await (const _event of a.runTurn('say hi')) void _event;

    // The runner now holds several events (seq 0..N). Attach asking to skip
    // ahead - the runner must ignore that and replay everything anyway.
    const skipTo = a.log.length;
    expect(skipTo).toBeGreaterThan(0);
    const late = await connectRemoteSession({ socketPath, role: 'late', sinceSeq: skipTo });
    remotes.push(late);

    // Mirror is fully populated, not empty (which is what the bug produced).
    expect(late.log.length).toBe(skipTo);
    const replayed = late.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(replayed?.content).toContain('first answer');

    // And it stays in sync: a turn the late client drives extends its mirror
    // contiguously rather than dropping events against a desynced index.
    for await (const _event of late.runTurn('again')) void _event;
    expect(late.log.length).toBeGreaterThan(skipTo);
    const followups = late.log.ofType('assistant_message');
    expect(followups[followups.length - 1]?.content).toContain('second answer');
  });

  it('runs the turn under a client-supplied turnId so per-turn filters match (v6)', async () => {
    // Regression: the desktop pre-mints a turn id per renderer request, but the
    // server used to mint its OWN id — so renderer filters on the returned id
    // (skill-generation preview, turn hiding) never matched any event.
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('tagged')] }));
    const remote = await attach(socketPath);
    const minted = asTurnId('client-minted-turn');
    const turnIds = new Set<string>();
    for await (const event of remote.runTurn('say hi', { turnId: minted })) {
      turnIds.add(event.turnId);
    }
    expect([...turnIds]).toEqual([minted]);
    // The authoritative log carries the client's id too, not a server-minted one.
    expect(remote.log.byTurn(minted).length).toBeGreaterThan(0);
  });

  it('rejects a client-supplied turnId that is already in flight (collision)', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('unused')] }));
    // A mode that blocks until aborted, so the first turn is still in flight
    // when the colliding request lands.
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-collision',
        modes: [
          defineMode({
            name: 'wait-mode',

            run: async function* (modeCtx) {
              await new Promise<void>((resolve) => {
                if (modeCtx.signal.aborted) return resolve();
                modeCtx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            },
          }),
        ],
      }),
    );
    session.modes.setActive('wait-mode');
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    const minted = asTurnId('duplicate-turn');
    const controller = new AbortController();
    const first = (async () => {
      for await (const _event of remote.runTurn('block', { turnId: minted, signal: controller.signal })) {
        void _event;
      }
    })();
    await waitFor(() => session.log.length > 0);

    const second = (async () => {
      for await (const _event of remote.runTurn('hijack', { turnId: minted })) void _event;
    })();
    await expect(second).rejects.toThrow(/already in flight/);

    controller.abort();
    await expect(first).resolves.toBeUndefined();
  });

  it('skips the history replay when a client attaches with replay "none" (v6)', async () => {
    const { session, socketPath } = await serve(
      new FakeProvider({ script: [textReply('first answer'), textReply('live answer')] }),
    );
    const a = await attach(socketPath, 'first');
    for await (const _event of a.runTurn('say hi')) void _event;
    const historyLen = session.log.length;
    expect(historyLen).toBeGreaterThan(0);

    const late = await connectRemoteSession({ socketPath, role: 'late', replay: 'none' });
    remotes.push(late);
    // No history was replayed into the mirror...
    expect(late.log.length).toBe(0);

    // ...but live events still stream in contiguously: ReplayStart rebased the
    // mirror to the runner's current seq, so the next event is accepted.
    for await (const _event of late.runTurn('again')) void _event;
    expect(late.log.length).toBeGreaterThan(0);
    // Original (authoritative) seqs are preserved on the rebased mirror.
    expect(late.log.at(historyLen)?.seq).toBe(historyLen);
    const fresh = late.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(fresh?.content).toContain('live answer');
    expect(JSON.stringify(late.log.toJSON())).not.toContain('first answer');
  });

  it('replays only the last N events when a client attaches with replay { tail } (v6)', async () => {
    const { session, socketPath } = await serve(
      new FakeProvider({ script: [textReply('first answer')] }),
    );
    const a = await attach(socketPath, 'first');
    for await (const _event of a.runTurn('say hi')) void _event;
    const historyLen = session.log.length;
    // At minimum a user_prompt and an assistant_message.
    expect(historyLen).toBeGreaterThan(1);

    const late = await connectRemoteSession({ socketPath, role: 'late', replay: { tail: 1 } });
    remotes.push(late);
    expect(late.log.length).toBe(1);
    // The tail keeps its authoritative seq (rebased mirror, not re-numbered).
    expect(late.log.at(historyLen - 1)?.seq).toBe(historyLen - 1);
    expect(late.log.at(historyLen - 2)).toBeUndefined();
  });

  it('session.reset re-arms a replay-"none" (rebased) mirror at seq 0', async () => {
    const { session, socketPath } = await serve(
      new FakeProvider({ script: [textReply('first answer'), textReply('post-reset answer')] }),
    );
    const a = await attach(socketPath, 'first');
    for await (const _event of a.runTurn('say hi')) void _event;
    expect(session.log.length).toBeGreaterThan(0);

    const late = await connectRemoteSession({ socketPath, role: 'late', replay: 'none' });
    remotes.push(late);

    await late.reset();
    expect(session.log.length).toBe(0);

    // Post-reset events restart at seq 0; the cleared mirror must accept them
    // (clear() reset the rebased base back to 0).
    for await (const _event of late.runTurn('again')) void _event;
    expect(late.log.at(0)?.seq).toBe(0);
    const fresh = late.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(fresh?.content).toContain('post-reset answer');
  });

  it('routes a tool-call permission prompt to the turn-owning client', async () => {
    const { socketPath } = await serve(
      new FakeProvider({ script: [toolUseReply('echo', { text: 'yo' }), textReply('done')] }),
    );
    const remote = await attach(socketPath);
    const asked: string[] = [];
    remote.setPermissionResolver({
      name: 'test-resolver',
      check: async (call) => {
        asked.push(call.name);
        return { mode: 'allow' };
      },
    });

    for await (const _event of remote.runTurn('use echo')) void _event;

    expect(asked).toContain('echo');
    expect(remote.log.ofType('tool_result').length).toBeGreaterThan(0);
  });

  it('proxies registry reads + action RPCs (mode switch, command run)', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    // A second mode to switch to, and a registered slash command.
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-extras',
        modes: [
          defineMode({
            name: 'echo-mode',
             
            run: async function* () {
              return;
            },
          }),
        ],
        commands: [
          {
            name: 'ping',
            description: 'reply pong',
            handler: () => ({ kind: 'text', text: 'pong' }) as CommandOutput,
          },
        ],
      }),
    );
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    // Reads come off the snapshot.
    expect(remote.modes.list().map((m) => m.name)).toContain('echo-mode');
    expect(remote.commands.get('ping')?.description).toBe('reply pong');

    // mode.setActive RPC flips the server's active mode; info.changed refreshes
    // the client snapshot.
    remote.modes.setActive('echo-mode');
    await waitFor(() => remote.getInfo().activeMode === 'echo-mode');
    expect(session.modes.getActive().name).toBe('echo-mode');

    // command.run RPC executes the real command on the runner.
    const result = await remote.commands.get('ping')!.handler({
      channel: 'tui',
      sessionId: remote.id,
      args: '',
      session: remote,
    });
    expect(result).toEqual({ kind: 'text', text: 'pong' });
  });

  it('sets the session reasoning effort, which flows into the provider request (v9)', async () => {
    // A reasoning-capable model — the effort is gated on the descriptor's
    // `supportsReasoning` in collectProviderStream, so the catalog must opt in.
    const provider = new FakeProvider({
      models: [
        {
          id: 'reasoner',
          contextWindow: 200_000,
          maxOutputTokens: 8000,
          supportsTools: true,
          supportsStreaming: true,
          supportsReasoning: true,
        },
      ],
      script: [textReply('thought hard'), textReply('thought less')],
    });
    const { session, socketPath } = await serve(provider);
    const remote = await attach(socketPath);

    // Default: no reasoning preference, so the request carries none.
    expect(session.reasoning).toBeUndefined();

    // settings.setReasoning RPC maps the effort onto session.reasoning (the CLI's
    // config.context.reasoning shape) and broadcasts info.changed.
    await remote.providerAdmin.setReasoning('high');
    await waitFor(() => session.reasoning !== undefined);
    expect(session.reasoning).toEqual({ effort: 'high' });

    // A turn now forwards it to the provider request (descriptor opts in).
    for await (const _event of remote.runTurn('think')) void _event;
    expect(provider.received.at(-1)?.reasoning).toEqual({ effort: 'high' });

    // 'off' clears it — the next turn's request carries no reasoning param.
    await remote.providerAdmin.setReasoning('off');
    await waitFor(() => session.reasoning === undefined);
    for await (const _event of remote.runTurn('think less')) void _event;
    expect(provider.received.at(-1)?.reasoning).toBeUndefined();
  });

  it('persists the picked provider to preferences so the next runner inherits it', async () => {
    // Regression: a remote `providers.setActive` only mutated THIS runner's
    // in-memory state. The desktop spawns one `moxxy serve` PER workspace, so
    // creating a workspace after connecting a (non-default) provider booted a
    // fresh runner that defaulted back to `anthropic`, found no key, came up
    // `connected` but provider-less, and bounced the user to "Connect a
    // provider". The runner must persist the pick to ~/.moxxy/config.yaml
    // (`plugins.provider.default`, like the TUI / Telegram pickers) so the next
    // runner picks it up.
    const home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-prefs-'));
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      const socketPath = tmpSocket();
      const provider = new FakeProvider({ script: [textReply('hi')] });
      const session = buildSession(provider);
      // A second provider to switch to — `fake` is active at boot.
      session.pluginHost.registerStatic(
        definePlugin({
          name: 'runner-test-second-provider',
          providers: [
            defineProvider({
              name: 'fake2',
              models: [...provider.models],
              createClient: () => provider,
            }),
          ],
        }),
      );
      const server = await startRunnerServer(session, { socketPath });
      servers.push(server);
      const remote = await attach(socketPath);

      remote.providers.setActive('fake2');
      await waitFor(() => session.providers.getActiveName() === 'fake2');

      // Persisting `plugins.provider.default` is fire-and-forget inside the
      // handler, so poll the config until the async write lands.
      const deadline = Date.now() + 2000;
      let persisted: string | null = null;
      while (persisted !== 'fake2' && Date.now() < deadline) {
        persisted = await loadActiveProvider();
        if (persisted !== 'fake2') await new Promise((r) => setTimeout(r, 5));
      }
      expect(persisted).toBe('fake2');
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      await rm(home, { recursive: true, force: true });
    }
  });

  it('broadcasts a turn started by one client to other attached clients', async () => {
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('shared answer')] }));
    const driver = await attach(socketPath, 'driver');
    const observer = await attach(socketPath, 'observer');

    for await (const _event of driver.runTurn('say hi')) void _event;

    await waitFor(() => observer.log.ofType('assistant_message').length > 0);
    const seen = observer.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(seen?.content).toContain('shared answer');
  });

  it('falls back to the server resolver when the client installs none', async () => {
    // buildSession uses autoAllowResolver, which the server keeps as the
    // fall-through. A client that never calls setPermissionResolver should
    // still get its tool calls auto-allowed by that fallback.
    const { socketPath } = await serve(
      new FakeProvider({ script: [toolUseReply('echo', { text: 'hey' }), textReply('done')] }),
    );
    const remote = await attach(socketPath);
    for await (const _event of remote.runTurn('use echo')) void _event;
    expect(remote.log.ofType('tool_result').length).toBeGreaterThan(0);
  });

  it('aborts an in-flight turn when the client signals abort', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('unused')] }));
    // A mode that blocks until the turn signal aborts.
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-wait',
        modes: [
          defineMode({
            name: 'wait-mode',
             
            run: async function* (modeCtx) {
              await new Promise<void>((resolve) => {
                if (modeCtx.signal.aborted) return resolve();
                modeCtx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            },
          }),
        ],
      }),
    );
    session.modes.setActive('wait-mode');
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    const controller = new AbortController();
    const drained = (async () => {
      for await (const _event of remote.runTurn('block', { signal: controller.signal })) {
        void _event;
      }
    })();
    // Give the turn a moment to start, then abort it.
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    // The turn must end rather than hang.
    await expect(drained).resolves.toBeUndefined();
  });

  it('logs an audit line for a cross-client abort and denies it under strict mode', async () => {
    // Cross-client abort is allowed by design (TUI + desktop share ONE
    // session, so aborting your own session from another client is
    // legitimate) - but it must leave an audit trail naming both connections,
    // and MOXXY_RUNNER_STRICT_ABORT=1 must deny it outright.
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const auditLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: (msg, meta) => warns.push({ msg, ...(meta ? { meta } : {}) }),
      error: () => {},
      child: () => auditLogger,
    };
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('unused')] }), auditLogger);
    // A mode that blocks until the turn signal aborts, so the turn is still
    // in flight when the second client fires its abort.
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-cross-abort',
        modes: [
          defineMode({
            name: 'wait-mode',

            run: async function* (modeCtx) {
              await new Promise<void>((resolve) => {
                if (modeCtx.signal.aborted) return resolve();
                modeCtx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            },
          }),
        ],
      }),
    );
    session.modes.setActive('wait-mode');
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);

    const driver = await attach(socketPath, 'driver');
    const drained = (async () => {
      for await (const _event of driver.runTurn('block')) void _event;
    })();
    // Learn the in-flight turnId from the authoritative log.
    await waitFor(() => session.log.length > 0);
    const turnId = session.log.at(0)!.turnId;

    // A second client on its own connection (raw peer - RemoteSession only
    // aborts turns it started itself).
    const peer = new JsonRpcPeer(await connectUnixSocket(socketPath));
    try {
      await peer.request(RunnerMethod.Attach, {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        role: 'second-ui',
        sinceSeq: 0,
      });

      process.env.MOXXY_RUNNER_STRICT_ABORT = '1';
      try {
        await expect(peer.request(RunnerMethod.Abort, { turnId })).rejects.toThrow(
          /cross-client abort denied/,
        );
      } finally {
        delete process.env.MOXXY_RUNNER_STRICT_ABORT;
      }

      // Default (shared-session) policy: the abort goes through...
      await peer.request(RunnerMethod.Abort, { turnId });
      await expect(drained).resolves.toBeUndefined();
    } finally {
      peer.close();
    }

    // ...and BOTH attempts left an audit line naming the two connections.
    const audit = warns.filter((w) => w.msg === 'cross-client abort');
    expect(audit.length).toBe(2);
    for (const entry of audit) {
      expect(entry.meta).toMatchObject({ turnId, ownerRole: 'driver', abortingRole: 'second-ui' });
    }
  });

  it('routes an approval checkpoint to the turn-owning client', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('unused')] }));
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-approval',
        modes: [
          defineMode({
            name: 'approval-mode',
             
            run: async function* (modeCtx) {
              await modeCtx.approval?.confirm({
                title: 'proceed?',
                body: 'plan goes here',
                options: [{ id: 'yes', label: 'Yes' }],
                defaultOptionId: 'yes',
              });
            },
          }),
        ],
      }),
    );
    session.modes.setActive('approval-mode');
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    const titles: string[] = [];
    remote.setApprovalResolver({
      name: 'test-approval',
      confirm: async (req) => {
        titles.push(req.title);
        return { optionId: 'yes' };
      },
    });

    for await (const _event of remote.runTurn('go')) void _event;
    expect(titles).toContain('proceed?');
  });

  it('takes the default option for a scoped turn whose client does not handle approvals (no host fallback pestered)', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('unused')] }));
    let decided: { optionId: string } | undefined;
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-approval-default',
        modes: [
          defineMode({
            name: 'approval-default-mode',
            run: async function* (modeCtx) {
              decided = await modeCtx.approval?.confirm({
                title: 'proceed?',
                body: 'plan goes here',
                options: [
                  { id: 'yes', label: 'Yes' },
                  { id: 'no', label: 'No' },
                ],
                defaultOptionId: 'yes',
              });
            },
          }),
        ],
      }),
    );
    session.modes.setActive('approval-default-mode');
    // Install a host fallback resolver that, if reached, would pick a different
    // option — so we can prove the scoped+!handles path does NOT fall through.
    session.setApprovalResolver({
      name: 'host-fallback',
      confirm: async () => ({ optionId: 'no' }),
    });
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    // Attach a client but DO NOT call setApprovalResolver → handlesApproval=false.
    const remote = await attach(socketPath);

    for await (const _event of remote.runTurn('go')) void _event;
    // Headless semantics: the default option, not the host fallback's 'no'.
    expect(decided).toEqual({ optionId: 'yes' });
  });

  it('fires onClose and flips connected when the runner stops', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    const server = await startRunnerServer(session, { socketPath });
    const remote = await attach(socketPath);
    expect(remote.connected).toBe(true);

    const closed = new Promise<void>((resolve) => remote.onClose(() => resolve()));
    await server.close();
    await closed;
    expect(remote.connected).toBe(false);
  });

  it('retries the initial connect until the runner is listening', async () => {
    const socketPath = tmpSocket();
    // Begin connecting before the server exists; it should retry, not throw.
    const connecting = connectRemoteSession({ socketPath, role: 'eager' });
    await new Promise((r) => setTimeout(r, 150));
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await connecting;
    remotes.push(remote);
    expect(remote.connected).toBe(true);
    expect(remote.getInfo().activeProvider).toBe('fake');
  });

  it('proxies audio transcription to the runner transcriber', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-stt',
        transcribers: [
          defineTranscriber({
            name: 'fake-stt',
            createClient: () => ({
              name: 'fake-stt',
              transcribe: async () => ({ text: 'transcribed on the runner' }),
            }),
          }),
        ],
      }),
    );
    session.transcribers.setActive('fake-stt');
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    expect(remote.getInfo().activeTranscriber).toBe('fake-stt');
    const transcriber = remote.transcribers.tryGetActive();
    expect(transcriber).not.toBeNull();
    const result = await transcriber!.transcribe(new Uint8Array([1, 2, 3]), {
      mimeType: 'audio/ogg',
    });
    expect(result.text).toBe('transcribed on the runner');
  });

  it('session.reset clears the runner, every mirror, and the persisted JSONL', async () => {
    // Regression for A10: /new on an attached client used to clear only the
    // local mirror — the runner kept the full context (resurrecting it on the
    // next provider call and replaying it on reattach), and the desynced
    // mirror silently rejected every subsequent event (ingest only accepts
    // contiguous seq). reset() must wipe the source of truth and re-sync
    // every attached client.
    const sessionsDir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-reset-'));
    try {
      const socketPath = tmpSocket();
      const session = buildSession(
        new FakeProvider({ script: [textReply('first answer'), textReply('second answer')] }),
      );
      const persistence = new SessionPersistence({
        sessionId: session.id,
        cwd: session.cwd,
        dir: sessionsDir,
      });
      const detach = persistence.attach(session.log);
      const server = await startRunnerServer(session, { socketPath });
      servers.push(server);

      const driver = await attach(socketPath, 'driver');
      const observer = await attach(socketPath, 'observer');

      for await (const _event of driver.runTurn('say hi')) void _event;
      await waitFor(() => observer.log.ofType('assistant_message').length > 0);
      const preResetLen = session.log.length;
      expect(preResetLen).toBeGreaterThan(0);
      // The sidecar flushed the pre-reset history.
      await waitForAsync(async () => (await restoreSessionEvents(session.id, sessionsDir)).length === preResetLen);

      await driver.reset();

      // Source of truth and BOTH mirrors are empty (the notification is
      // broadcast before the RPC reply, but the observer rides a separate
      // socket — poll it).
      expect(session.log.length).toBe(0);
      expect(driver.log.length).toBe(0);
      await waitFor(() => observer.log.length === 0);
      // --resume sees an empty session: the JSONL was truncated, not kept.
      await waitForAsync(async () => (await restoreSessionEvents(session.id, sessionsDir)).length === 0);

      // Post-reset events restart at seq 0 and every mirror ingests them —
      // previously the cleared mirror rejected the whole stream forever.
      for await (const _event of observer.runTurn('again')) void _event;
      await waitFor(() => driver.log.ofType('assistant_message').length > 0);
      expect(driver.log.at(0)?.seq).toBe(0);
      expect(observer.log.at(0)?.seq).toBe(0);
      const fresh = driver.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
      expect(fresh?.content).toContain('second answer');

      // The persisted file holds only the post-reset conversation.
      const postLen = session.log.length;
      await waitForAsync(async () => (await restoreSessionEvents(session.id, sessionsDir)).length === postLen);
      const persisted = await restoreSessionEvents(session.id, sessionsDir);
      expect(persisted[0]?.seq).toBe(0);
      expect(JSON.stringify(persisted)).not.toContain('first answer');

      detach();
    } finally {
      await rm(sessionsDir, { recursive: true, force: true });
    }
  });

  it('keeps routing installed when a self-hosting client sets its own resolvers', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);

    // A self-hosting TUI installs its own resolvers AFTER the runner wrapped
    // the session. These must redirect into the fallback, not replace routing -
    // otherwise an attached client's prompts would surface on the host.
    session.setApprovalResolver({ name: 'local-tui', confirm: async () => ({ optionId: 'x' }) });
    session.setPermissionResolver({ name: 'local-perm', check: async () => ({ mode: 'allow' }) });

    expect(session.approvalResolver?.name).toBe('runner-routing');
    expect(session.resolver.name).toBe('runner-routing');
  });

  it('forwards the workflows builder methods (validateDraft/save/getRun) to the runner', async () => {
    // Finding 2: the desktop drives a RemoteSession, whose workflows view used
    // to omit the builder methods, so validateDraft/save/getRun were undefined
    // and the builder was non-functional on desktop. They must reach the real
    // handler over the runner socket (protocol v4).
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
    session.workflows = {
      list: async () => [],
      setEnabled: async () => undefined,
      run: async () => ({ ok: true, output: '', steps: [] }),
      validateDraft: async (yaml) => {
        calls.push({ method: 'validateDraft', arg: yaml });
        return { ok: false, errors: ['steps: step "a" needs unknown step "x"'] };
      },
      save: async (yaml, previousName) => {
        calls.push({ method: 'save', arg: yaml, arg2: previousName });
        return { name: 'renamed', scope: 'user', path: '/tmp/renamed.yaml' };
      },
      getRun: async (name) => {
        calls.push({ method: 'getRun', arg: name });
        return { name, scope: 'user', path: '/tmp/x.yaml', yaml: 'name: x' };
      },
    };
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    const validated = await remote.workflows.validateDraft('name: bad');
    expect(validated.ok).toBe(false);
    expect(validated.errors[0]).toContain('needs unknown step');

    const saved = await remote.workflows.save('name: renamed', 'old-name');
    expect(saved.name).toBe('renamed');

    const detail = await remote.workflows.getRun('x');
    expect(detail?.yaml).toBe('name: x');

    expect(calls).toEqual([
      { method: 'validateDraft', arg: 'name: bad' },
      { method: 'save', arg: 'name: renamed', arg2: 'old-name' },
      { method: 'getRun', arg: 'x' },
    ]);
  });

  it('rejects the workflows builder methods when the runner lacks the builder slice', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    // A workflows view WITHOUT the optional builder methods (older plugin).
    session.workflows = {
      list: async () => [],
      setEnabled: async () => undefined,
      run: async () => ({ ok: true, output: '', steps: [] }),
    };
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    await expect(remote.workflows.validateDraft('name: x')).rejects.toThrow(/builder not supported/);
  });

  it('forwards workflow.resume to the runner workflows view (human-in-the-loop, v5)', async () => {
    // A paired client answers a paused workflow's awaitInput question: the
    // reply must reach session.workflows.resume(runId, reply) over the socket.
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    let resumed: { runId: string; reply: string } | null = null;
    session.workflows = {
      list: async () => [],
      setEnabled: async () => undefined,
      run: async () => ({ ok: true, output: '', steps: [] }),
      resume: async (runId, reply) => {
        resumed = { runId, reply };
        return { ok: true, output: 'final', steps: [{ id: 'ask', status: 'completed' }] };
      },
    };
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);
    expect(remote.runnerProtocolVersion).toBe(RUNNER_PROTOCOL_VERSION);

    const result = await remote.workflows.resume('run-7', 'ship it');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('final');
    expect(resumed).toEqual({ runId: 'run-7', reply: 'ship it' });
  });

  it('rejects workflow.resume when the runner workflows view lacks resume (older host)', async () => {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    session.workflows = {
      list: async () => [],
      setEnabled: async () => undefined,
      run: async () => ({ ok: true, output: '', steps: [] }),
    };
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    await expect(remote.workflows.resume('run-7', 'hi')).rejects.toThrow(/resume not supported/);
  });
});

describe('provider management (protocol v7)', () => {
  /** Run `fn` with HOME redirected to a temp dir so preference writes land
   *  in the test sandbox (same pattern as the persists-provider test). */
  async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
    const home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-prov-'));
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      await fn(home);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      await rm(home, { recursive: true, force: true });
    }
  }

  function withSecondProvider(session: Session, provider: FakeProvider): void {
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'runner-test-second-provider',
        providers: [
          defineProvider({
            name: 'fake2',
            models: [...provider.models],
            createClient: () => provider,
          }),
        ],
      }),
    );
  }

  it('provider.setEnabled disables in the live registry, persists, and pushes info', async () => {
    await withTempHome(async (home) => {
      const socketPath = tmpSocket();
      const provider = new FakeProvider({ script: [textReply('hi')] });
      const session = buildSession(provider);
      withSecondProvider(session, provider);
      const server = await startRunnerServer(session, { socketPath });
      servers.push(server);
      const remote = await attach(socketPath);

      await remote.providerAdmin.setEnabled('fake2', false);
      expect(session.providers.isEnabled('fake2')).toBe(false);
      // The push refreshes the client snapshot.
      await waitFor(
        () => remote.getInfo().providers.find((p) => p.name === 'fake2')?.enabled === false,
      );
      // Persisted (fire-and-forget) as `plugins.provider.items.fake2.enabled:
      // false` so the next boot's walk skips it.
      await waitForAsync(async () => (await loadDisabledProviders()).includes('fake2'));

      // Re-enable: registry + persisted flag both flip back.
      await remote.providerAdmin.setEnabled('fake2', true);
      expect(session.providers.isEnabled('fake2')).toBe(true);
      await waitForAsync(async () => !(await loadDisabledProviders()).includes('fake2'));
    });
  });

  it('serializes concurrent provider.setEnabled toggles so neither drops the other (invariant #5)', async () => {
    // Regression (u120-2): handleProviderSetEnabled persists each provider's
    // `plugins.provider.items.<name>.enabled` flag through @moxxy/config's
    // mutexed writer. Two overlapping toggles (the model can fire tools in
    // parallel; the desktop can toggle two providers in quick succession) write
    // DIFFERENT fields; the writer's mutex serializes them so the second reads
    // the doc including the first's write — BOTH disables land, neither lost.
    await withTempHome(async (home) => {
      const socketPath = tmpSocket();
      const provider = new FakeProvider({ script: [textReply('hi')] });
      const session = buildSession(provider);
      // Two extra non-active providers to disable concurrently — `fake` stays
      // active (disabling the active one throws).
      session.pluginHost.registerStatic(
        definePlugin({
          name: 'runner-test-extra-providers',
          providers: [
            defineProvider({ name: 'fake2', models: [...provider.models], createClient: () => provider }),
            defineProvider({ name: 'fake3', models: [...provider.models], createClient: () => provider }),
          ],
        }),
      );
      const server = await startRunnerServer(session, { socketPath });
      servers.push(server);
      const remote = await attach(socketPath);

      // Fire both toggles concurrently. The RPCs resolve before the
      // fire-and-forget prefs write lands, so we poll the file afterwards.
      await Promise.all([
        remote.providerAdmin.setEnabled('fake2', false),
        remote.providerAdmin.setEnabled('fake3', false),
      ]);

      // Each toggle is a single-field write serialized by the config writer's
      // own mutex, so BOTH names survive the concurrent toggles (the second
      // writer reads the doc including the first's write).
      await waitForAsync(async () => {
        const set = new Set(await loadDisabledProviders());
        return set.has('fake2') && set.has('fake3');
      });
      expect([...(await loadDisabledProviders())].sort()).toEqual(['fake2', 'fake3']);

      // And the live registry reflects both — behaviour of each toggle is
      // unchanged, the mutex only serialized the persistence.
      expect(session.providers.isEnabled('fake2')).toBe(false);
      expect(session.providers.isEnabled('fake3')).toBe(false);
    });
  });

  it('does not lose a disabledProviders update when setActive races a setEnabled toggle', async () => {
    // handleProviderSetActive persists `plugins.provider.default` and the toggle
    // persists `plugins.provider.items.<name>.enabled` — different fields, both
    // serialized by the config writer's mutex. A setActive racing a toggle must
    // not clobber the other; both effects persist.
    await withTempHome(async (home) => {
      const socketPath = tmpSocket();
      const provider = new FakeProvider({ script: [textReply('hi')] });
      const session = buildSession(provider);
      session.pluginHost.registerStatic(
        definePlugin({
          name: 'runner-test-active-race',
          providers: [
            defineProvider({ name: 'fake2', models: [...provider.models], createClient: () => provider }),
            defineProvider({ name: 'fake3', models: [...provider.models], createClient: () => provider }),
          ],
        }),
      );
      const server = await startRunnerServer(session, { socketPath });
      servers.push(server);
      const remote = await attach(socketPath);

      // Disable fake3 while switching the active provider to fake2.
      await Promise.all([
        remote.providerAdmin.setEnabled('fake3', false),
        remote.providers.setActive('fake2'),
      ]);

      await waitForAsync(async () => {
        const provider = await loadActiveProvider();
        const disabled = await loadDisabledProviders();
        return provider === 'fake2' && disabled.includes('fake3');
      });
      expect(await loadActiveProvider()).toBe('fake2');
      expect(await loadDisabledProviders()).toContain('fake3');
    });
  });

  it('provider.setEnabled refuses to disable the ACTIVE provider', async () => {
    await withTempHome(async () => {
      const provider = new FakeProvider({ script: [textReply('hi')] });
      const { socketPath } = await serve(provider);
      const remote = await attach(socketPath);
      await expect(remote.providerAdmin.setEnabled(provider.name, false)).rejects.toThrow(
        /active provider/i,
      );
    });
  });

  it('provider.refreshReady re-probes credentials via the session resolver', async () => {
    const socketPath = tmpSocket();
    const provider = new FakeProvider({ script: [textReply('hi')] });
    const session = buildSession(provider);
    withSecondProvider(session, provider);
    // Only fake2 resolves; the probe must add it to readyProviders.
    session.credentialResolver = async (name) => {
      if (name === 'fake2') return {};
      throw new Error('no credentials');
    };
    session.readyProviders = new Set();
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    await remote.providerAdmin.refreshReady();
    // The active provider is always included; fake2 resolved.
    expect([...(session.readyProviders ?? [])].sort()).toEqual([provider.name, 'fake2'].sort());
    await waitFor(() => remote.getInfo().readyProviders.includes('fake2'));
  });

  it('provider.configure forwards to the session providerAdmin view and pushes info', async () => {
    const socketPath = tmpSocket();
    const provider = new FakeProvider({ script: [textReply('hi')] });
    const session = buildSession(provider);
    const configured: Array<{ name: string; patch: unknown }> = [];
    // Session.providerAdmin is a getter over the 'providerAdmin' service the
    // provider-admin plugin publishes in onInit — emulate that here.
    session.services.register('providerAdmin', {
      configure: async (name: string, patch: unknown) => {
        configured.push({ name, patch });
      },
    });
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    const remote = await attach(socketPath);

    await remote.providerAdmin.configure('zai', { baseURL: 'https://api.z.ai/v1' });
    expect(configured).toEqual([{ name: 'zai', patch: { baseURL: 'https://api.z.ai/v1' } }]);
  });

  it('provider.configure rejects cleanly when the runner lacks the providerAdmin view', async () => {
    const provider = new FakeProvider({ script: [textReply('hi')] });
    const { socketPath } = await serve(provider);
    const remote = await attach(socketPath);
    await expect(remote.providerAdmin.configure('zai', {})).rejects.toThrow(/not supported/);
  });

  it('broadcasts info.changed after a turn completes (registry-mutating tools)', async () => {
    const provider = new FakeProvider({ script: [textReply('done')] });
    const { socketPath } = await serve(provider);
    const remote = await attach(socketPath);

    let pushes = 0;
    remote.onInfoChanged(() => {
      pushes += 1;
    });
    for await (const event of remote.runTurn('hello')) void event;
    await waitFor(() => pushes >= 1);
    expect(pushes).toBeGreaterThanOrEqual(1);
  });
});

describe('surfaces (protocol v8)', () => {
  /** Serve a session with a fake `terminal` surface registered before boot. */
  async function serveWithSurface(): Promise<{
    socketPath: string;
    surface: ReturnType<typeof registerFakeSurface>;
  }> {
    const socketPath = tmpSocket();
    const session = buildSession(new FakeProvider({ script: [textReply('hi')] }));
    const surface = registerFakeSurface(session, 'terminal');
    const server = await startRunnerServer(session, { socketPath });
    servers.push(server);
    return { socketPath, surface };
  }

  it('surface.list reports the registered kind + availability over the socket', async () => {
    const { socketPath } = await serveWithSurface();
    const remote = await attach(socketPath);
    const list = await remote.listSurfaces();
    expect(list.map((s) => s.kind)).toContain('terminal');
    expect(list.find((s) => s.kind === 'terminal')?.available).toBe(true);
  });

  it('surface.open returns the surfaceId + catch-up snapshot and opens the instance once', async () => {
    const { socketPath, surface } = await serveWithSurface();
    const remote = await attach(socketPath);

    const opened = await remote.openSurface('terminal');
    expect(opened.kind).toBe('terminal');
    expect(opened.surfaceId).toBe('terminal-instance');
    expect(opened.snapshot).toEqual({ scrollback: 'catch-up' });
    expect(surface.state.opens).toBe(1);
  });

  it('rebroadcasts an instance frame as a surface.data notification carrying surfaceId/kind/payload', async () => {
    const { socketPath, surface } = await serveWithSurface();
    const remote = await attach(socketPath);
    const opened = await remote.openSurface('terminal');

    const frames: SurfaceDataMessage[] = [];
    remote.onSurfaceData((data) => frames.push(data));
    surface.emit({ bytes: 'ls\r\n' });

    await waitFor(() => frames.length > 0);
    expect(frames[0]).toEqual({
      surfaceId: opened.surfaceId,
      kind: 'terminal',
      payload: { bytes: 'ls\r\n' },
    });
  });

  it('surface.input / surface.resize reach the instance by id', async () => {
    const { socketPath, surface } = await serveWithSurface();
    const remote = await attach(socketPath);
    const opened = await remote.openSurface('terminal');

    await remote.inputSurface(opened.surfaceId, { type: 'data', data: 'echo hi\n' });
    await remote.resizeSurface(opened.surfaceId, { cols: 100, rows: 30 });

    expect(surface.state.inputs).toEqual([{ type: 'data', data: 'echo hi\n' }]);
    expect(surface.state.resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('surface.close tears the instance down and stops further surface.data frames', async () => {
    const { socketPath, surface } = await serveWithSurface();
    const remote = await attach(socketPath);
    const opened = await remote.openSurface('terminal');

    const frames: SurfaceDataMessage[] = [];
    remote.onSurfaceData((data) => frames.push(data));
    await remote.closeSurface(opened.surfaceId);
    expect(surface.state.closed).toBe(1);

    // A frame from the (test-controlled) emitter after close must not reach the
    // client: the host dropped its subscription on teardown.
    surface.emit({ bytes: 'post-close' });
    await new Promise((r) => setTimeout(r, 20));
    expect(frames).toHaveLength(0);
  });

  it('rejects surface.input with bad params (schema parse)', async () => {
    const { socketPath } = await serveWithSurface();
    const remote = await attach(socketPath);
    await remote.openSurface('terminal');

    // Drive the raw peer so we bypass RemoteSession's typed wrappers and hit the
    // server's zod schema directly: an empty surfaceId must reject.
    const peer = new JsonRpcPeer(await connectUnixSocket(socketPath));
    try {
      await peer.request(RunnerMethod.Attach, {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        role: 'raw',
        sinceSeq: 0,
      });
      await expect(
        peer.request(RunnerMethod.SurfaceInput, { surfaceId: '', message: { type: 'data' } }),
      ).rejects.toThrow();
    } finally {
      peer.close();
    }
  });

  it('surface.open throws a clear error when no surface plugin is registered', async () => {
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('hi')] }));
    const remote = await attach(socketPath);
    await expect(remote.openSurface('terminal')).rejects.toThrow(/No surface registered/);
  });
});

/** A reply that STREAMS text deltas then fails mid-stream WITHOUT a clean
 *  message_end — collectProviderStream returns `{ text, error }`, so the
 *  default mode loop returns without sealing an assistant_message. */
function streamThenError(chunks: ReadonlyArray<string>): ReadonlyArray<ProviderEvent> {
  return [
    { type: 'message_start', model: 'fake' },
    ...chunks.map<ProviderEvent>((c) => ({ type: 'text_delta', delta: c })),
    { type: 'error', message: 'provider blew up mid-stream', retryable: false },
  ];
}

/** Like {@link streamThenError} but the mid-stream error is RETRYABLE, so the
 *  default-mode loop backs off and RETRIES (consuming the NEXT scripted reply)
 *  instead of ending the turn — leaving this iteration's streamed chunks in the
 *  log with no sealing `assistant_message`. */
function streamThenRetryable(chunks: ReadonlyArray<string>): ReadonlyArray<ProviderEvent> {
  return [
    { type: 'message_start', model: 'fake' },
    ...chunks.map<ProviderEvent>((c) => ({ type: 'text_delta', delta: c })),
    { type: 'error', message: 'transient blip — retry', retryable: true },
  ];
}

describe('session.loadHistory paging (protocol v10)', () => {
  it('returns the newest page and walks older pages via prevCursor to a null start', async () => {
    // Build a multi-turn conversation so the log has many events to page.
    const { socketPath } = await serve(
      new FakeProvider({
        script: [textReply('a1'), textReply('a2'), textReply('a3')],
      }),
    );
    const remote = await attach(socketPath);
    for await (const _e of remote.runTurn('q1')) void _e;
    for await (const _e of remote.runTurn('q2')) void _e;
    for await (const _e of remote.runTurn('q3')) void _e;
    const total = remote.log.length;
    expect(total).toBeGreaterThan(3);

    // Newest page.
    const newest = await remote.loadHistory(null, 4);
    expect(newest.events.length).toBe(4);
    // It is the tail of the log, in ascending seq order.
    expect(newest.events.map((e) => e.seq)).toEqual([total - 4, total - 3, total - 2, total - 1]);
    expect(newest.prevCursor).toBe(total - 4);

    // Walk all the way back; the collected seqs reconstruct the whole log once.
    const collected: number[] = [...newest.events.map((e) => e.seq)];
    let before = newest.prevCursor;
    for (let guard = 0; guard < 100 && before !== null; guard += 1) {
      const page: SessionLoadHistoryResult = await remote.loadHistory(before, 4);
      collected.unshift(...page.events.map((e) => e.seq));
      before = page.prevCursor;
    }
    expect(collected).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it('returns an empty page with a null cursor for an empty log', async () => {
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('unused')] }));
    const remote = await attach(socketPath);
    const page = await remote.loadHistory(null, 10);
    expect(page.events).toEqual([]);
    expect(page.prevCursor).toBeNull();
  });

  it('returns the whole log and a null cursor when limit exceeds history', async () => {
    const { socketPath } = await serve(new FakeProvider({ script: [textReply('only answer')] }));
    const remote = await attach(socketPath);
    for await (const _e of remote.runTurn('q')) void _e;
    const total = remote.log.length;

    const page = await remote.loadHistory(null, 1000);
    expect(page.events.map((e) => e.seq)).toEqual(Array.from({ length: total }, (_, i) => i));
    // The start of history is included → no older page.
    expect(page.prevCursor).toBeNull();
    // The page IS the authoritative log (same content the mirror holds).
    expect(JSON.stringify(page.events)).toBe(JSON.stringify(remote.log.toJSON()));
  });
});

describe('session.loadHistory version gate (protocol v10)', () => {
  /** A pair of in-memory transports wired to each other (mirrors remote-session.test). */
  function makePair(): [import('./transport.js').Transport, import('./transport.js').Transport] {
    let aOnFrame: ((f: unknown) => void) | undefined;
    let bOnFrame: ((f: unknown) => void) | undefined;
    let aOnClose: ((e?: Error) => void) | undefined;
    let bOnClose: ((e?: Error) => void) | undefined;
    let closed = false;
    const closeBoth = (): void => {
      if (closed) return;
      closed = true;
      queueMicrotask(() => {
        aOnClose?.();
        bOnClose?.();
      });
    };
    const a: import('./transport.js').Transport = {
      send: (f) => {
        if (!closed) queueMicrotask(() => bOnFrame?.(f));
      },
      onFrame: (h) => {
        aOnFrame = h;
      },
      onClose: (h) => {
        aOnClose = h;
      },
      close: closeBoth,
    };
    const b: import('./transport.js').Transport = {
      send: (f) => {
        if (!closed) queueMicrotask(() => aOnFrame?.(f));
      },
      onFrame: (h) => {
        bOnFrame = h;
      },
      onClose: (h) => {
        bOnClose = h;
      },
      close: closeBoth,
    };
    return [a, b];
  }

  const fakeInfo = {
    sessionId: 'fake',
    cwd: process.cwd(),
    providers: [],
    tools: [],
    modes: [],
    skills: [],
    commands: [],
    readyProviders: [],
    activeProvider: null,
    activeMode: null,
  } as const;

  it('throws an actionable error against a runner reporting protocol < 10', async () => {
    const [clientT, serverT] = makePair();
    const server = new JsonRpcPeer(serverT);
    let loadHistoryCalled = false;
    // An OLDER runner: reports v9 and has no session.loadHistory handler.
    server.handle(RunnerMethod.Attach, () => ({
      sessionId: 'fake',
      protocolVersion: 9,
      info: fakeInfo,
    }));
    server.handle(RunnerMethod.SessionLoadHistory, () => {
      loadHistoryCalled = true;
      return { events: [], prevCursor: null };
    });
    const client = new RemoteSession(clientT);
    await client.attach('desktop', 0);
    expect(client.runnerProtocolVersion).toBe(9);

    // The client must NOT hit the wire — it gates and throws a clear, actionable
    // "update the CLI" error so the desktop can catch it and fall back to NDJSON.
    await expect(client.loadHistory(null, 50)).rejects.toThrow(/update the moxxy CLI/i);
    await expect(client.loadHistory(null, 50)).rejects.toThrow(/v9, needs v10/);
    expect(loadHistoryCalled).toBe(false);
    clientT.close();
  });

  it('reaches the runner when it reports protocol >= 10', async () => {
    const [clientT, serverT] = makePair();
    const server = new JsonRpcPeer(serverT);
    server.handle(RunnerMethod.Attach, () => ({
      sessionId: 'fake',
      protocolVersion: 10,
      info: fakeInfo,
    }));
    server.handle(RunnerMethod.SessionLoadHistory, (raw) => {
      const { before, limit } = raw as { before: number | null; limit: number };
      return { events: [], prevCursor: before === null ? null : limit };
    });
    const client = new RemoteSession(clientT);
    await client.attach('desktop', 0);
    const page = await client.loadHistory(null, 50);
    expect(page).toEqual({ events: [], prevCursor: null });
    clientT.close();
  });
});

describe('log completeness: stream-without-seal', () => {
  it('persists a REAL assistant_message when streamed text was never sealed', async () => {
    // The provider streams text deltas then errors before a clean message_end,
    // so the default-mode loop returns without emitting an assistant_message.
    // The runner must seal the streamed text into a real assistant_message so
    // the runner log is the complete authoritative history (no renderer synth).
    const { session, socketPath } = await serve(
      new FakeProvider({ script: [streamThenError(['par', 'tial ', 'reply'])] }),
    );
    const remote = await attach(socketPath);

    // Drive the turn to completion (it ends in a fatal error event).
    const streamedTypes: string[] = [];
    for await (const event of remote.runTurn('go')) streamedTypes.push(event.type);

    // Chunks DID stream (so the renderer would otherwise have to synthesize)...
    expect(streamedTypes).toContain('assistant_chunk');

    // ...and the AUTHORITATIVE runner log now carries a REAL assistant_message
    // reconstructed from those chunks — with a normal seq, not the renderer's -1.
    const sealed = session.log.ofType('assistant_message');
    expect(sealed.length).toBe(1);
    expect((sealed[0] as AssistantMessageEvent).content).toBe('partial reply');
    expect(sealed[0]!.seq).toBeGreaterThanOrEqual(0);

    // The mirror received it as a normal streamed event too.
    const mirrored = remote.log.ofType('assistant_message')[0] as AssistantMessageEvent | undefined;
    expect(mirrored?.content).toBe('partial reply');
  });

  it('does NOT double-seal the normal (provider-sealed) path', async () => {
    // A clean reply seals its own assistant_message; the runner must not append
    // a second one. Behavior-preserving for the common case.
    const { session, socketPath } = await serve(
      new FakeProvider({ script: [streamingTextReply(['hel', 'lo'])] }),
    );
    const remote = await attach(socketPath);
    for await (const _e of remote.runTurn('hi')) void _e;

    const sealed = session.log.ofType('assistant_message');
    expect(sealed.length).toBe(1);
    expect((sealed[0] as AssistantMessageEvent).content).toBe('hello');
  });

  it('seals only the FINAL iteration text, not an abandoned retryable attempt', async () => {
    // A turn can stream text, hit a RETRYABLE provider error (transient
    // 429/outage), retry, stream MORE text, then end without a clean
    // assistant_message. The seal must keep only the final attempt's text — the
    // abandoned attempt's chunks must NOT bleed into the sealed reply, which
    // would durably corrupt the authoritative log ("ABANDONED-final").
    const { session, socketPath } = await serve(
      new FakeProvider({
        // iter 1: streams "ABANDONED-" then a RETRYABLE error → the loop retries.
        // iter 2: streams "final" then a NON-retryable error → turn ends unsealed.
        script: [streamThenRetryable(['ABAN', 'DONED-']), streamThenError(['fin', 'al'])],
      }),
    );
    const remote = await attach(socketPath);
    // One retryable retry incurs a single ~500ms back-off; the turn still ends
    // in a fatal error event.
    for await (const _e of remote.runTurn('go')) void _e;

    const sealed = session.log.ofType('assistant_message');
    expect(sealed.length).toBe(1);
    expect((sealed[0] as AssistantMessageEvent).content).toBe('final');
  });
});
