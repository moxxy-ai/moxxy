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
import {
  asTurnId,
  defineMode,
  definePlugin,
  defineProvider,
  defineTool,
  defineTranscriber,
  z,
} from '@moxxy/sdk';
import type { AssistantMessageEvent, CommandOutput } from '@moxxy/sdk';
import { FakeProvider, textReply, toolUseReply } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { startRunnerServer, type RunnerServer } from './server.js';
import { connectRemoteSession, type RemoteSession } from './remote-session.js';
import { connectUnixSocket } from './unix-socket.js';
import { JsonRpcPeer } from './jsonrpc.js';
import { RUNNER_PROTOCOL_VERSION, RunnerMethod } from './protocol.js';

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

  it('persists the picked provider to preferences so the next runner inherits it', async () => {
    // Regression: a remote `providers.setActive` only mutated THIS runner's
    // in-memory state. The desktop spawns one `moxxy serve` PER workspace, so
    // creating a workspace after connecting a (non-default) provider booted a
    // fresh runner that defaulted back to `anthropic`, found no key, came up
    // `connected` but provider-less, and bounced the user to "Connect a
    // provider". The runner must persist the pick to ~/.moxxy/preferences.json
    // (like the TUI / Telegram pickers) so the next runner picks it up.
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

      // savePreferences is fire-and-forget inside the handler, so poll the
      // file until the async write lands.
      const prefsPath = path.join(home, '.moxxy', 'preferences.json');
      const deadline = Date.now() + 2000;
      let persisted: { providerName?: string } = {};
      while (persisted.providerName !== 'fake2' && Date.now() < deadline) {
        try {
          persisted = JSON.parse(await readFile(prefsPath, 'utf8')) as { providerName?: string };
        } catch {
          /* not written yet */
        }
        if (persisted.providerName !== 'fake2') await new Promise((r) => setTimeout(r, 5));
      }
      expect(persisted.providerName).toBe('fake2');
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
      // Persisted (fire-and-forget) so the next boot's walk skips it.
      const prefsPath = path.join(home, '.moxxy', 'preferences.json');
      await waitForAsync(async () => {
        const prefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
          disabledProviders?: string[];
        };
        return prefs.disabledProviders?.includes('fake2') === true;
      });

      // Re-enable: registry + persisted list both flip back.
      await remote.providerAdmin.setEnabled('fake2', true);
      expect(session.providers.isEnabled('fake2')).toBe(true);
      await waitForAsync(async () => {
        const prefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
          disabledProviders?: string[];
        };
        return prefs.disabledProviders?.includes('fake2') === false;
      });
    });
  });

  it('serializes concurrent provider.setEnabled toggles so neither drops the other (invariant #5)', async () => {
    // Regression (u120-2): handleProviderSetEnabled does a read-modify-write of
    // preferences.json — load disabledProviders, add/remove one name, save. Two
    // overlapping toggles (the model can fire tools in parallel; the desktop can
    // toggle two providers in quick succession) each read the SAME stale set,
    // and without serialization the second writer clobbers the first — one
    // disable silently vanishes. The runner's `prefsMutex` must serialize the
    // whole load→compute→save body so BOTH names land in the persisted list.
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

      const prefsPath = path.join(home, '.moxxy', 'preferences.json');
      // The mutex guarantees BOTH names survive the read-modify-write race.
      await waitForAsync(async () => {
        const prefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
          disabledProviders?: string[];
        };
        const set = new Set(prefs.disabledProviders ?? []);
        return set.has('fake2') && set.has('fake3');
      });
      const finalPrefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
        disabledProviders?: string[];
      };
      expect([...(finalPrefs.disabledProviders ?? [])].sort()).toEqual(['fake2', 'fake3']);

      // And the live registry reflects both — behaviour of each toggle is
      // unchanged, the mutex only serialized the persistence.
      expect(session.providers.isEnabled('fake2')).toBe(false);
      expect(session.providers.isEnabled('fake3')).toBe(false);
    });
  });

  it('does not lose a disabledProviders update when setActive races a setEnabled toggle', async () => {
    // The other prefs writer (handleProviderSetActive, which persists
    // providerName) shares the same `prefsMutex`. A setActive firing between a
    // toggle's load and its save must not clobber disabledProviders, and the
    // toggle must not clobber providerName. Both effects persist.
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

      const prefsPath = path.join(home, '.moxxy', 'preferences.json');
      await waitForAsync(async () => {
        const prefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
          providerName?: string;
          disabledProviders?: string[];
        };
        return (
          prefs.providerName === 'fake2' &&
          (prefs.disabledProviders ?? []).includes('fake3')
        );
      });
      const finalPrefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
        providerName?: string;
        disabledProviders?: string[];
      };
      expect(finalPrefs.providerName).toBe('fake2');
      expect(finalPrefs.disabledProviders).toContain('fake3');
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
    session.providerAdmin = {
      configure: async (name, patch) => {
        configured.push({ name, patch });
      },
    };
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
