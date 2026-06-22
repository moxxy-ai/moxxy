/**
 * Regression: a turn parked on a human-in-the-loop loop-strategy approval
 * gate must survive a redundant pool change. A redundant `connected` pool
 * change must NOT dispose+recreate the driver underneath that turn — doing
 * so aborts the runner-side turn, and the post-approval execution step then
 * reports "did not complete cleanly".
 *
 * We drive a real RunnerServer + RemoteSession running a minimal mode that
 * parks the turn on `ctx.approval.confirm` (the same gate plan-execute /
 * research modes use), and assert:
 *   - `driver.wraps(session)` is true for the live session (the guard the
 *     IPC layer uses to skip a needless recreate), and
 *   - disposing the driver mid-approval aborts the turn (the hazard the
 *     guard avoids).
 */
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import {
  asPluginId,
  defineMode,
  definePlugin,
  defineProvider,
  defineTool,
  z,
  type ModeContext,
  type MoxxyEvent,
  type UserPromptAttachment,
} from '@moxxy/sdk';
import { FakeProvider, textReply } from '@moxxy/testing';
import {
  startRunnerServer,
  connectRemoteSession,
  type RunnerServer,
  type RemoteSession,
} from '@moxxy/runner';
import type { BrowserWindow } from 'electron';
import { SessionDriver } from './session-driver';
import { answerAsk } from './ask-broker';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';

const GATE_MODE_NAME = 'test-gate';

/**
 * Minimal test-only mode: park on an approval gate, and on approval emit a
 * `plugin_event` with subtype `plan_completed` (the completion marker the
 * assertions wait for). Replaces the former plan-execute dependency — the
 * SessionDriver behaviour under test is mode-agnostic.
 */
const gateModePlugin = definePlugin({
  name: '@moxxy/test-gate-mode',
  version: '0.0.0',
  modes: [
    defineMode({
      name: GATE_MODE_NAME,
      description: 'test-only mode that parks on an approval gate then completes',
      run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
        let approved = true;
        if (ctx.approval) {
          try {
            const decision = await ctx.approval.confirm({
              title: 'Plan ready — review before executing',
              body: '1. step one\n2. step two',
              kind: 'test.plan',
              defaultOptionId: 'approve',
              options: [
                { id: 'approve', label: 'Approve and run', hotkey: 'a' },
                { id: 'cancel', label: 'Cancel this turn', hotkey: 'c', danger: true },
              ],
            });
            approved = decision.optionId === 'approve';
          } catch {
            approved = false;
          }
        }
        // Disposing the driver mid-approval cancels the parked ask (resolved to
        // the danger option) and aborts the turn — record the abort and never
        // reach plan_completed, mirroring how mode-tool-use bails on abort.
        if (ctx.signal.aborted || !approved) {
          yield await ctx.emit({
            type: 'abort',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'system',
            reason: 'gate cancelled',
          });
          return;
        }
        yield await ctx.emit({
          type: 'plugin_event',
          pluginId: asPluginId('@moxxy/test-gate-mode'),
          subtype: 'plan_completed',
          payload: {},
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'plugin',
        });
      },
    }),
  ],
});

function tmpSocket(): string {
  return path.join(os.tmpdir(), `moxxy-driver-${Math.random().toString(36).slice(2, 10)}.sock`);
}

/** Minimal stand-in for an Electron BrowserWindow — SessionDriver only
 *  touches window.isDestroyed / webContents.isDestroyed / webContents.send /
 *  once / removeListener. */
function fakeWindow(): {
  win: BrowserWindow;
  sent: Array<{ channel: string; payload: unknown }>;
} {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const emitter = new EventEmitter();
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    },
    once: (ev: string, fn: () => void) => emitter.once(ev, fn),
    removeListener: (ev: string, fn: () => void) => emitter.removeListener(ev, fn),
  };
  return { win: win as unknown as BrowserWindow, sent };
}

const servers: RunnerServer[] = [];
const remotes: RemoteSession[] = [];

afterEach(async () => {
  await Promise.all(remotes.splice(0).map((r) => r.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function buildSession(provider: FakeProvider): Session {
  const session = new Session({
    cwd: process.cwd(),
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'driver-test-shim',
      providers: [
        defineProvider({
          name: provider.name,
          models: [...provider.models],
          createClient: () => provider,
        }),
      ],
      tools: [
        defineTool({
          name: 'Write',
          description: 'write a file',
          inputSchema: z.object({ file_path: z.string(), content: z.string() }),
          permission: { action: 'prompt' },
          handler: (input) => `wrote ${input.file_path}`,
        }),
      ],
    }),
  );
  session.providers.setActive(provider.name);
  session.pluginHost.registerStatic(gateModePlugin);
  session.modes.setActive(GATE_MODE_NAME);
  return session;
}

async function serveGatedTurn(): Promise<RemoteSession> {
  // The gate mode never calls the provider; a trivial script suffices.
  const provider = new FakeProvider({ script: [textReply('ok')] });
  const socketPath = tmpSocket();
  const server = await startRunnerServer(buildSession(provider), { socketPath });
  servers.push(server);
  const remote = await connectRemoteSession({ socketPath, role: 'driver-test' });
  remotes.push(remote);
  return remote;
}

describe('SessionDriver approval-gate survival', () => {
  it('wraps() identifies the live session so the IPC layer can skip a recreate', async () => {
    const remote = await serveGatedTurn();
    const { win } = fakeWindow();
    const driver = new SessionDriver(remote, win, 'ws');
    expect(driver.wraps(remote)).toBe(true);
    const other = await serveGatedTurn();
    expect(driver.wraps(other)).toBe(false);
    driver.dispose();
  });

  it('runs the gated turn to completion when the driver is left in place', async () => {
    const remote = await serveGatedTurn();
    const { win, sent } = fakeWindow();
    // The driver installs the broker-backed resolvers; the renderer (here,
    // this test) answers each ask.request through `answerAsk`. Auto-approve
    // the plan and allow every permission, mirroring a user clicking through.
    const stop = autoAnswer(sent, (req) =>
      req.kind === 'approval' ? { optionId: 'approve' } : { mode: 'allow_session' },
    );
    const driver = new SessionDriver(remote, win, 'ws');

    const { turnId } = await driver.runTurn('do the work');
    expect(turnId).toBeTruthy();
    expect(sent).toContainEqual({
      channel: 'runner.turn.started',
      payload: { workspaceId: 'ws', turnId },
    });

    await waitFor(() =>
      remote.log
        .slice()
        .some((e) => e.type === 'plugin_event' && e.subtype === 'plan_completed'),
    );
    const errs = remote.log.ofType('error');
    expect(errs).toHaveLength(0);
    // The driver's pre-minted id must reach the runner (protocol v6): every
    // event of the turn carries THE id runTurn returned to the renderer —
    // that's what renderer-side per-turn filters (skill-generation preview,
    // turn hiding) key on. Previously the runner minted its own id and the
    // returned one matched nothing.
    const turnEvents = remote.log.slice();
    expect(turnEvents.length).toBeGreaterThan(0);
    expect(turnEvents.every((e) => e.turnId === turnId)).toBe(true);
    stop();
    driver.dispose();
  });

  it('broadcasts ask.resolved after any surface answers a permission prompt', async () => {
    const { remote, captured } = fakeRemote();
    const { win, sent } = fakeWindow();
    const driver = new SessionDriver(remote, win, 'ws-ask');

    const decision = captured.permission!.check(
      { name: 'Write', input: { file_path: 'out.txt' } },
      { toolDescription: 'write a file' },
    );
    await waitFor(() => sent.some((f) => f.channel === 'ask.request'));

    const req = sent.find((f) => f.channel === 'ask.request')!.payload as AskRequest;
    answerAsk(req.requestId, { mode: 'allow_session' } as never);

    await expect(decision).resolves.toEqual({ mode: 'allow_session' });
    expect(sent).toContainEqual({
      channel: 'ask.resolved',
      payload: { workspaceId: 'ws-ask', requestId: req.requestId },
    });
    driver.dispose();
  });

  it('disposing the driver while parked on the approval aborts the turn (the hazard wraps() prevents)', async () => {
    const remote = await serveGatedTurn();
    const { win, sent } = fakeWindow();
    // Auto-allow permissions, but DO NOT answer the approval ask — leave the
    // turn parked at the human-in-the-loop gate, exactly as if the user were
    // still reading the plan in the bottom sheet.
    let approvalRaised = false;
    const stop = autoAnswer(sent, (req) => {
      if (req.kind === 'approval') {
        approvalRaised = true;
        return null; // park
      }
      return { mode: 'allow_session' };
    });
    const driver = new SessionDriver(remote, win, 'ws');
    await driver.runTurn('do the work');

    // Wait until the approval gate is reached.
    await waitFor(() => approvalRaised);

    // A bad pool change disposes the driver mid-approval. dispose() cancels
    // the pending ask AND aborts the in-flight turn — the runner-side turn
    // ends and the post-approval step can't run.
    driver.dispose();

    // The turn must NOT reach plan_completed.
    await waitFor(() => {
      const aborted = remote.log.slice().some((e) => e.type === 'abort');
      const completed = remote.log
        .slice()
        .some((e) => e.type === 'plugin_event' && e.subtype === 'plan_completed');
      const erred = remote.log.ofType('error').length > 0;
      return aborted || completed || erred;
    });
    const completed = remote.log
      .slice()
      .some((e) => e.type === 'plugin_event' && e.subtype === 'plan_completed');
    expect(completed).toBe(false);
    stop();
  });
});

/**
 * Poll the fake window's outbound IPC for `ask.request` frames and answer
 * each one through the broker (`answerAsk`), the same path the renderer's
 * `ask.respond` IPC handler uses. Returning `null` from `respond` parks the
 * ask (simulates a user still deciding). Returns a stop() to end polling.
 */
function autoAnswer(
  sent: Array<{ channel: string; payload: unknown }>,
  respond: (req: AskRequest) => { mode?: string; optionId?: string; text?: string } | null,
): () => void {
  const answered = new Set<string>();
  const timer = setInterval(() => {
    for (const frame of sent) {
      if (frame.channel !== 'ask.request') continue;
      const req = frame.payload as AskRequest;
      if (answered.has(req.requestId)) continue;
      const reply = respond(req);
      if (reply === null) {
        answered.add(req.requestId); // park, but don't re-evaluate
        continue;
      }
      answered.add(req.requestId);
      answerAsk(req.requestId, reply as never);
    }
  }, 3);
  return () => clearInterval(timer);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Minimal RemoteSession stand-in that just captures the permission resolver
 * the driver installs, so we can exercise auto-approve without a real runner.
 */
interface PermissionCheck {
  check: (
    call: { name: string; input: unknown },
    ctx: { toolDescription?: string },
  ) => Promise<{ mode: string }>;
}
function fakeRemote(options: {
  readonly runTurn?: (prompt: string, opts: unknown) => AsyncIterable<unknown>;
} = {}): {
  remote: RemoteSession;
  captured: { permission?: PermissionCheck };
  fireInfoChanged: () => void;
} {
  const captured: { permission?: PermissionCheck } = {};
  const infoListeners = new Set<() => void>();
  const remote = {
    log: { subscribe: () => () => undefined },
    setPermissionResolver: (r: PermissionCheck) => {
      captured.permission = r;
    },
    setApprovalResolver: () => undefined,
    runTurn: options.runTurn ?? (async function* runTurn() {}),
    onClose: () => undefined,
    onInfoChanged: (fn: () => void) => {
      infoListeners.add(fn);
      return () => infoListeners.delete(fn);
    },
    onSurfaceData: () => () => undefined,
  };
  return {
    remote: remote as unknown as RemoteSession,
    captured,
    fireInfoChanged: () => {
      for (const fn of infoListeners) fn();
    },
  };
}

describe('SessionDriver auto-approve', () => {
  it('allows tool calls without raising an ask when auto-approve is on', async () => {
    const { remote, captured } = fakeRemote();
    const { win, sent } = fakeWindow();
    const driver = new SessionDriver(remote, win, 'ws');
    driver.setAutoApprove(true);

    const res = await captured.permission!.check({ name: 'Write', input: {} }, {});

    expect(res).toEqual({ mode: 'allow' });
    expect(sent.some((f) => f.channel === 'ask.request')).toBe(false);
    driver.dispose();
  });

  it('falls back to asking the renderer when auto-approve is off', async () => {
    const { remote, captured } = fakeRemote();
    const { win, sent } = fakeWindow();
    const driver = new SessionDriver(remote, win, 'ws');

    // Don't answer — leave the ask parked, like a user still deciding.
    const p = captured.permission!.check({ name: 'Write', input: {} }, {});
    await waitFor(() => sent.some((f) => f.channel === 'ask.request'));
    expect(sent.some((f) => f.channel === 'ask.request')).toBe(true);

    // Disposing cancels the parked ask; the resolver fails closed to deny.
    driver.dispose();
    const res = await p;
    expect(res.mode).toBe('deny');
  });
});

describe('SessionDriver info-changed forwarding', () => {
  it("mirrors the runner's info.changed push as a session.info.changed IPC event", () => {
    const { remote, fireInfoChanged } = fakeRemote();
    const { win, sent } = fakeWindow();
    const driver = new SessionDriver(remote, win, 'ws-1');

    fireInfoChanged();
    const frames = sent.filter((f) => f.channel === 'session.info.changed');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.payload).toEqual({ workspaceId: 'ws-1' });

    // After dispose the subscription is dropped — no more forwards.
    driver.dispose();
    fireInfoChanged();
    expect(sent.filter((f) => f.channel === 'session.info.changed')).toHaveLength(1);
  });
});

describe('SessionDriver inline attachments', () => {
  it('passes mobile inline attachments directly to the remote session turn', async () => {
    const inlineAttachments: ReadonlyArray<UserPromptAttachment> = [
      {
        kind: 'image',
        content: 'AQID',
        mediaType: 'image/png',
        name: 'phone-screen.png',
      },
    ];
    let receivedPrompt = '';
    let receivedOpts: { attachments?: ReadonlyArray<UserPromptAttachment> } | null = null;
    const { remote } = fakeRemote({
      runTurn: async function* runTurn(
        prompt: string,
        opts: { attachments?: ReadonlyArray<UserPromptAttachment> },
      ) {
        receivedPrompt = prompt;
        receivedOpts = opts;
      },
    });
    const { win, sent } = fakeWindow();
    const driver = new SessionDriver(remote, win, 'ws-inline');

    await driver.runTurn('Przeanalizuj obraz', undefined, undefined, inlineAttachments);
    await waitFor(() => sent.some((frame) => frame.channel === 'runner.turn.complete'));

    expect(receivedPrompt).toBe('Przeanalizuj obraz');
    expect(receivedOpts?.attachments).toEqual(inlineAttachments);
    driver.dispose();
  });
});
