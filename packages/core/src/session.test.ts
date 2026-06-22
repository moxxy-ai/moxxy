import { describe, expect, it, vi } from 'vitest';
import { asSessionId, asToolCallId, defineMode, definePlugin } from '@moxxy/sdk';
import { Session } from './session.js';
import {
  getRetainedChild,
  registerRetainedChild,
  releaseRetainedChild,
  type RetainedChildSession,
} from './subagents/registry.js';

describe('Session', () => {
  it('boots with sensible defaults', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    expect(s.id).toMatch(/^[0-9A-Z]+$/);
    expect(s.cwd).toBe('/tmp');
    expect(s.log.length).toBe(0);
    expect(s.signal.aborted).toBe(false);
  });

  it('abort flips signal', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    s.abort('test');
    expect(s.signal.aborted).toBe(true);
  });

  it('startTurn returns a fresh turn id', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const t1 = s.startTurn().turnId;
    const t2 = s.startTurn().turnId;
    expect(t1).not.toBe(t2);
  });

  it('exposes an immutable appContext snapshot', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const ctx = s.appContext();
    expect(ctx.sessionId).toBe(s.id);
    expect(ctx.cwd).toBe('/tmp');
    expect(ctx.log.length).toBe(0);
  });

  it('fans appended events out to plugin onEvent hooks', async () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const onEvent = vi.fn();
    s.pluginHost.registerStatic(
      definePlugin({
        name: 'observer',
        version: '0.0.0',
        hooks: { onEvent },
      }),
    );
    await s.log.append({
      type: 'user_prompt',
      sessionId: s.id,
      turnId: s.startTurn().turnId,
      source: 'user',
      text: 'hi',
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    const arg = onEvent.mock.calls[0]![0] as { type: string; text?: string };
    expect(arg.type).toBe('user_prompt');
    expect(arg.text).toBe('hi');
  });

  it('close() fires plugin onShutdown hooks and aborts the session', async () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const onShutdown = vi.fn();
    s.pluginHost.registerStatic(
      definePlugin({ name: 'p', version: '0.0.0', hooks: { onShutdown } }),
    );
    await s.close();
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(s.signal.aborted).toBe(true);
  });

  it('close() still runs plugin onShutdown when surface teardown rejects', async () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const onShutdown = vi.fn();
    s.pluginHost.registerStatic(
      definePlugin({ name: 'p', version: '0.0.0', hooks: { onShutdown } }),
    );
    // A flaky native surface (PTY/browser) throwing during teardown must not
    // pre-empt the plugin shutdown hooks — those are how plugins flush state.
    vi.spyOn(s.surfaces, 'closeAll').mockRejectedValue(new Error('PTY teardown blew up'));

    await expect(s.close()).resolves.toBeUndefined();
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(s.signal.aborted).toBe(true);
  });

  it('appContext env is a frozen, stable snapshot (reused across calls)', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const a = s.appContext();
    const b = s.appContext();
    // Memoized: the same frozen object is handed out, not a fresh clone each call.
    expect(a.env).toBe(b.env);
    expect(Object.isFrozen(a.env)).toBe(true);
  });

  it('close() is idempotent', async () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const onShutdown = vi.fn();
    s.pluginHost.registerStatic(
      definePlugin({ name: 'p', version: '0.0.0', hooks: { onShutdown } }),
    );
    await s.close();
    await s.close();
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it('close() clears only THIS session\'s retained children, not another live session\'s', async () => {
    const a = new Session({ cwd: '/tmp', silent: true });
    const b = new Session({ cwd: '/tmp', silent: true });
    const childId = asSessionId('retained-scope-test');
    // A workflow awaitInput pause on session A registers a retained child whose
    // parentSession is A. Closing a DIFFERENT session (B) must NOT wipe it —
    // otherwise B's close breaks A's pending continue().
    registerRetainedChild({
      childSessionId: childId,
      parentSession: a,
    } as unknown as RetainedChildSession);
    expect(getRetainedChild(childId)).toBeDefined();
    try {
      await b.close();
      // Survives B's close — it belongs to A.
      expect(getRetainedChild(childId)).toBeDefined();
      // A's own close reclaims it.
      await a.close();
      expect(getRetainedChild(childId)).toBeUndefined();
    } finally {
      releaseRetainedChild(childId);
    }
  });

  it('getInfo returns a serializable snapshot of the registries', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const info = s.getInfo();
    expect(info.sessionId).toBe(s.id);
    expect(info.cwd).toBe('/tmp');
    // Bare session: nothing active yet, all lists empty, no transcriber.
    expect(info.activeProvider).toBeNull();
    expect(info.activeMode).toBeNull();
    expect(info.activeModeBadge).toBeNull();
    expect(info.providers).toEqual([]);
    expect(info.modes).toEqual([]);
    expect(info.tools).toEqual([]);
    expect(info.commands).toEqual([]);
    expect(info.readyProviders).toEqual([]);
    expect(info.hasTranscriber).toBe(false);
    // The snapshot must survive a JSON round-trip (it crosses the wire).
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });

  it('getInfo surfaces the active mode badge (and null for unbadged modes)', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    // First registration auto-activates — a badged mode lights up the snapshot
    // so channels can render a persistent indicator (e.g. goal mode).
    s.modes.register(
      defineMode({
        name: 'goal',
        badge: { label: 'GOAL', tone: 'attention' },
        run: async function* () {},
      }),
    );
    expect(s.getInfo().activeModeBadge).toEqual({ label: 'GOAL', tone: 'attention' });

    // Switching to a mode with no badge clears it back to null.
    s.modes.register(defineMode({ name: 'plain', run: async function* () {} }));
    s.modes.setActive('plain');
    expect(s.getInfo().activeMode).toBe('plain');
    expect(s.getInfo().activeModeBadge).toBeNull();
  });

  it('exposes runTurn as a method (SessionLike conformance)', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    expect(typeof s.runTurn).toBe('function');
    expect(typeof s.getInfo).toBe('function');
  });

  it('resolver.policyCheck probes policy without falling through to the prompt resolver', async () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    let prompted = 0;
    s.setPermissionResolver({
      name: 'counting-prompt',
      check: async () => {
        prompted += 1;
        return { mode: 'allow', reason: 'prompt said yes' };
      },
    });
    await s.permissions.addDeny({ name: 'Bash', reason: 'no shell' });

    const permCtx = { sessionId: String(s.id) };
    // A matching deny rule decides — prompt-free.
    const deny = await s.resolver.policyCheck?.(
      { callId: asToolCallId('c1'), name: 'Bash', input: {} },
      permCtx,
    );
    expect(deny).toEqual({ mode: 'deny', reason: 'no shell' });
    // No matching rule → null (the caller supplies its own fallback); the
    // wrapped prompt resolver is NEVER consulted by policyCheck.
    const undecided = await s.resolver.policyCheck?.(
      { callId: asToolCallId('c2'), name: 'Other', input: {} },
      permCtx,
    );
    expect(undecided).toBeNull();
    expect(prompted).toBe(0);
    // check() keeps its existing behavior: policy first, then fall through.
    const viaCheck = await s.resolver.check(
      { callId: asToolCallId('c3'), name: 'Other', input: {} },
      permCtx,
    );
    expect(viaCheck.mode).toBe('allow');
    expect(prompted).toBe(1);
  });

  it('resolver passes non-check members (e.g. abortAll) through to the underlying resolver with correct `this`', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const abortAll = vi.fn();
    // A resolver carrying an extra member that reads private-ish state via
    // `this` — the Proxy must forward both the call and the receiver binding.
    const inner = {
      name: 'channel-resolver',
      _closedReason: 'shutting down',
      check: async () => ({ mode: 'allow' as const }),
      abortAll,
      reasonViaThis(): string {
        return this._closedReason;
      },
    };
    s.setPermissionResolver(inner as never);

    const wrapped = s.resolver as unknown as {
      abortAll: (reason?: string) => void;
      reasonViaThis: () => string;
    };
    wrapped.abortAll('bye');
    expect(abortAll).toHaveBeenCalledWith('bye');
    // `this` is bound through the proxy so a method reading sibling state works.
    expect(wrapped.reasonViaThis()).toBe('shutting down');
  });
});
