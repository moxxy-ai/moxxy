import { afterEach, describe, expect, it } from 'vitest';
import {
  asEventId,
  asSessionId,
  asToolCallId,
  asTurnId,
  type EventLogReader,
  type LLMProvider,
  type MoxxyEvent,
  type ProviderEvent,
  type ProviderRequest,
  type ReflectContext,
  type ReflectionProposal,
  type ReflectorDef,
  type ServiceRegistry,
  type TurnContext,
} from '@moxxy/sdk';
import { FakeProvider, createFakeSession, textReply } from '@moxxy/testing';
import type { Session } from '@moxxy/core';
import {
  REFLECT_MIN_ITERATIONS,
  REFLECT_MIN_TOOL_RESULTS,
  buildReflectorPlugin,
  buildTurnDigest,
  parseReflectionReply,
  reflectorDefaultDef,
  shouldReflect,
} from './index.js';

// ── event + context fakes ───────────────────────────────────────────────────

const sid = asSessionId('s1');
const tid = asTurnId('t1');

function makeEvents(): {
  userPrompt: (text: string) => MoxxyEvent;
  toolCall: (name: string) => MoxxyEvent;
  toolResult: (ok: boolean, errMsg?: string) => MoxxyEvent;
  errorEv: (message: string) => MoxxyEvent;
  modeIter: (iteration: number) => MoxxyEvent;
  assistantMsg: (content: string) => MoxxyEvent;
} {
  let seq = 0;
  const base = (): { id: ReturnType<typeof asEventId>; seq: number; ts: number; sessionId: typeof sid; turnId: typeof tid; source: 'system' } => ({
    id: asEventId(`e${seq}`),
    seq: seq++,
    ts: seq,
    sessionId: sid,
    turnId: tid,
    source: 'system',
  });
  return {
    userPrompt: (text) => ({ ...base(), type: 'user_prompt', text }) as MoxxyEvent,
    toolCall: (name) => ({ ...base(), type: 'tool_call_requested', callId: asToolCallId(`c${name}`), name, input: {} }) as MoxxyEvent,
    toolResult: (ok, errMsg) =>
      ({
        ...base(),
        type: 'tool_result',
        callId: asToolCallId('c'),
        ok,
        ...(errMsg ? { error: { message: errMsg, kind: 'threw' } } : {}),
      }) as MoxxyEvent,
    errorEv: (message) => ({ ...base(), type: 'error', kind: 'fatal', message }) as MoxxyEvent,
    modeIter: (iteration) => ({ ...base(), type: 'mode_iteration', strategy: 'default', iteration }) as MoxxyEvent,
    assistantMsg: (content) => ({ ...base(), type: 'assistant_message', content, stopReason: 'end_turn' }) as MoxxyEvent,
  };
}

/** A busy turn that trips the gate (5 tool results) + a prompt + assistant text. */
function busyTurn(): MoxxyEvent[] {
  const e = makeEvents();
  return [
    e.userPrompt('deploy the service'),
    e.toolCall('Bash'),
    e.toolResult(true),
    e.toolResult(true),
    e.toolResult(true),
    e.toolResult(true),
    e.toolResult(true),
    e.assistantMsg('done, deployed'),
  ];
}

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  const arr = [...events];
  const base = arr.length > 0 ? arr[0]!.seq : 0;
  return {
    length: arr.length,
    at: (seq: number) => arr[seq - base],
    slice: (from = base, to = base + arr.length) =>
      arr.slice(Math.max(0, from - base), Math.max(0, to - base)),
    ofType: ((type: string) => arr.filter((ev) => ev.type === type)) as EventLogReader['ofType'],
    byTurn: (turnId) => arr.filter((ev) => ev.turnId === turnId),
    toJSON: () => arr,
  };
}

function services(map: Record<string, unknown>): ServiceRegistry {
  return {
    register: () => {},
    get: (<T>(name: string) => map[name] as T | undefined) as ServiceRegistry['get'],
    require: (<T>(name: string) => {
      const v = map[name];
      if (v === undefined) throw new Error(`missing service ${name}`);
      return v as T;
    }) as ServiceRegistry['require'],
    has: (name: string) => name in map,
  };
}

function providersStub(provider: LLMProvider | null): unknown {
  return {
    getActiveName: () => (provider ? provider.name : null),
    getActive: () => {
      if (!provider) throw new Error('no active provider');
      return provider;
    },
  };
}

function reflectorsStub(def: ReflectorDef | null): unknown {
  return { getActive: () => def };
}

function turnCtx(events: ReadonlyArray<MoxxyEvent>, svc: ServiceRegistry): TurnContext {
  return { sessionId: sid, turnId: tid, cwd: '/tmp', log: reader(events), env: {}, services: svc, iteration: 0 };
}

function reflectCtx(events: ReadonlyArray<MoxxyEvent>, svc: ServiceRegistry): ReflectContext {
  return {
    sessionId: sid,
    turnId: tid,
    cwd: '/tmp',
    log: reader(events),
    services: svc,
    signal: AbortSignal.timeout(30_000),
  };
}

const replyJson = (proposals: ReadonlyArray<ReflectionProposal>): string => JSON.stringify(proposals);

// ── shouldReflect (the gate) ────────────────────────────────────────────────

describe('shouldReflect', () => {
  const e = makeEvents();

  it('is false for a quiet turn (below every threshold)', () => {
    const events = [e.userPrompt('hi'), e.toolCall('Bash'), e.toolResult(true), e.assistantMsg('hello')];
    expect(shouldReflect(events)).toBe(false);
  });

  it(`fires at ${REFLECT_MIN_TOOL_RESULTS} tool results`, () => {
    const events = Array.from({ length: REFLECT_MIN_TOOL_RESULTS }, () => e.toolResult(true));
    expect(shouldReflect(events)).toBe(true);
    expect(shouldReflect(events.slice(0, REFLECT_MIN_TOOL_RESULTS - 1))).toBe(false);
  });

  it('fires on a single error event', () => {
    expect(shouldReflect([e.errorEv('boom')])).toBe(true);
  });

  it(`fires at ${REFLECT_MIN_ITERATIONS} mode iterations`, () => {
    const events = Array.from({ length: REFLECT_MIN_ITERATIONS }, (_, i) => e.modeIter(i));
    expect(shouldReflect(events)).toBe(true);
    expect(shouldReflect(events.slice(0, REFLECT_MIN_ITERATIONS - 1))).toBe(false);
  });
});

// ── buildTurnDigest ─────────────────────────────────────────────────────────

describe('buildTurnDigest', () => {
  it('summarizes prompt, tool names, error snippets, and final assistant text', () => {
    const e = makeEvents();
    const digest = buildTurnDigest([
      e.userPrompt('fix the build'),
      e.toolCall('Bash'),
      e.toolCall('Bash'),
      e.toolResult(false, 'exit code 1'),
      e.assistantMsg('fixed it'),
    ]);
    expect(digest).toContain('USER: fix the build');
    expect(digest).toContain('Bash×2');
    expect(digest).toContain('ERRORS: exit code 1');
    expect(digest).toContain('ASSISTANT: fixed it');
  });

  it('is empty for an empty turn', () => {
    expect(buildTurnDigest([])).toBe('');
  });
});

// ── parseReflectionReply ────────────────────────────────────────────────────

describe('parseReflectionReply', () => {
  it('parses a well-formed array', () => {
    const out = parseReflectionReply(
      replyJson([{ kind: 'memory', title: 'prefers pnpm', nudge: 'save that they use pnpm' }]),
    );
    expect(out).toEqual([{ kind: 'memory', title: 'prefers pnpm', nudge: 'save that they use pnpm' }]);
  });

  it('unwraps a ```json fenced block', () => {
    const out = parseReflectionReply('```json\n[{"kind":"skill","title":"t","nudge":"n"}]\n```');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('skill');
  });

  it('clamps to at most 2 proposals', () => {
    const out = parseReflectionReply(
      replyJson([
        { kind: 'memory', title: 'a', nudge: 'x' },
        { kind: 'memory', title: 'b', nudge: 'y' },
        { kind: 'skill', title: 'c', nudge: 'z' },
      ]),
    );
    expect(out).toHaveLength(2);
  });

  it('returns [] on malformed JSON', () => {
    expect(parseReflectionReply('not json at all')).toEqual([]);
    expect(parseReflectionReply('[{"kind": "memory"')).toEqual([]);
  });

  it('returns [] on a wrong-shape item (bad kind / missing field)', () => {
    expect(parseReflectionReply(replyJson([{ kind: 'other' as 'memory', title: 't', nudge: 'n' }]))).toEqual([]);
    expect(parseReflectionReply('[{"kind":"memory","title":"t"}]')).toEqual([]);
  });

  it('returns [] for a non-array and an empty array', () => {
    expect(parseReflectionReply('{"kind":"memory"}')).toEqual([]);
    expect(parseReflectionReply('[]')).toEqual([]);
  });
});

// ── reflectorDefaultDef.reflect (the strategy) ──────────────────────────────

describe('reflectorDefaultDef.reflect', () => {
  it('runs one provider pass and returns parsed proposals', async () => {
    const provider = new FakeProvider({
      name: 'fake',
      script: [textReply(replyJson([{ kind: 'skill', title: 'deploy flow', nudge: 'capture it' }]))],
    });
    const svc = services({ providers: providersStub(provider) });
    const out = await reflectorDefaultDef.reflect(reflectCtx(busyTurn(), svc));
    expect(out).toEqual([{ kind: 'skill', title: 'deploy flow', nudge: 'capture it' }]);
    expect(provider.received).toHaveLength(1);
    expect(provider.received[0]!.system).toContain('review a single finished agent turn');
  });

  it('skips silently when there is no active provider', async () => {
    const svc = services({ providers: providersStub(null) });
    expect(await reflectorDefaultDef.reflect(reflectCtx(busyTurn(), svc))).toEqual([]);
  });

  it('skips silently when the providers service is absent', async () => {
    const svc = services({});
    expect(await reflectorDefaultDef.reflect(reflectCtx(busyTurn(), svc))).toEqual([]);
  });

  it('returns [] (never throws) on a provider error', async () => {
    const errorScript: ReadonlyArray<ProviderEvent> = [
      { type: 'message_start', model: 'fake' },
      { type: 'error', message: 'upstream 500', retryable: false },
    ];
    const provider = new FakeProvider({ name: 'fake', script: [errorScript] });
    const svc = services({ providers: providersStub(provider) });
    expect(await reflectorDefaultDef.reflect(reflectCtx(busyTurn(), svc))).toEqual([]);
  });

  it('does not call the provider for an empty digest', async () => {
    const provider = new FakeProvider({ name: 'fake', script: [] });
    const svc = services({ providers: providersStub(provider) });
    expect(await reflectorDefaultDef.reflect(reflectCtx([], svc))).toEqual([]);
    expect(provider.received).toHaveLength(0);
  });
});

// ── the driver (buildReflectorPlugin hooks) ─────────────────────────────────

function driverServices(provider: LLMProvider | null, def: ReflectorDef | null = reflectorDefaultDef): ServiceRegistry {
  return services({ reflectors: reflectorsStub(def), providers: providersStub(provider) });
}

const goodReflection = (): FakeProvider =>
  new FakeProvider({
    name: 'fake',
    script: [textReply(replyJson([{ kind: 'memory', title: 'uses pnpm', nudge: 'remember pnpm' }]))],
  });

describe('reflector driver', () => {
  it('does not reflect on a quiet turn (gate)', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const provider = goodReflection();
    const e = makeEvents();
    const quiet = [e.userPrompt('hi'), e.toolResult(true), e.assistantMsg('hello')];
    await plugin.hooks!.onTurnEnd!(turnCtx(quiet, driverServices(provider)));
    await internals.settle(sid);
    expect(internals.budget(sid)).toBeUndefined();
    expect(internals.pendingNudge(sid)).toBeNull();
    expect(provider.received).toHaveLength(0);
  });

  it('reflects past the gate and stages a pending nudge', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const provider = goodReflection();
    await plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), driverServices(provider)));
    await internals.settle(sid);
    expect(internals.budget(sid)?.count).toBe(1);
    const nudge = internals.pendingNudge(sid);
    expect(nudge).toContain('[reflection]');
    expect(nudge).toContain('uses pnpm');
    expect(nudge).toContain('memory_save');
  });

  it('enforces a one-reflection-per-session budget', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const provider = goodReflection();
    await plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), driverServices(provider)));
    await internals.settle(sid);
    // A second busy turn must NOT fire a second reflection.
    await plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), driverServices(provider)));
    await internals.settle(sid);
    expect(provider.received).toHaveLength(1);
    expect(internals.budget(sid)?.count).toBe(1);
  });

  it('does not reflect (or spend budget) when no reflector is active', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const provider = goodReflection();
    await plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), driverServices(provider, null)));
    await internals.settle(sid);
    expect(internals.budget(sid)).toBeUndefined();
    expect(provider.received).toHaveLength(0);
  });

  it('injects the nudge exactly once on the next provider call, then clears it', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const provider = goodReflection();
    const ctx = turnCtx(busyTurn(), driverServices(provider));
    await plugin.hooks!.onTurnEnd!(ctx);
    await internals.settle(sid);

    const req: ProviderRequest = { model: 'm', system: 'BASE', messages: [] };
    const first = (await plugin.hooks!.onBeforeProviderCall!(req, ctx)) as ProviderRequest | undefined;
    expect(first?.system).toContain('BASE');
    expect(first?.system).toContain('uses pnpm');
    expect(internals.pendingNudge(sid)).toBeNull();

    const second = await plugin.hooks!.onBeforeProviderCall!(req, ctx);
    expect(second).toBeUndefined();
  });

  it('onTurnEnd returns without blocking on the reflection (fire-and-forget)', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const provider = goodReflection();
    const ret = plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), driverServices(provider)));
    // Resolves immediately; the reflection has NOT completed yet.
    expect(internals.pendingNudge(sid)).toBeNull();
    await ret; // onTurnEnd itself resolves fast
    await internals.settle(sid); // now the detached reflection has finished
    expect(internals.pendingNudge(sid)).not.toBeNull();
  });

  it('never throws into the turn when the reflector rejects', async () => {
    const throwing: ReflectorDef = {
      name: 'boom',
      reflect: () => Promise.reject(new Error('reflector exploded')),
    };
    const { plugin, internals } = buildReflectorPlugin();
    const svc = services({ reflectors: reflectorsStub(throwing), providers: providersStub(goodReflection()) });
    // onTurnEnd is synchronous (fire-and-forget): it must not throw, and the
    // rejected reflection must not surface after it settles.
    expect(() => plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), svc))).not.toThrow();
    await internals.settle(sid);
    expect(internals.pendingNudge(sid)).toBeNull();
  });

  it('never throws into the turn when the log reader is hostile', async () => {
    const { plugin } = buildReflectorPlugin();
    const hostileLog = {
      ...reader(busyTurn()),
      byTurn: () => {
        throw new Error('reader exploded');
      },
    } as EventLogReader;
    const ctx: TurnContext = {
      sessionId: sid,
      turnId: tid,
      cwd: '/tmp',
      log: hostileLog,
      env: {},
      services: driverServices(goodReflection()),
      iteration: 0,
    };
    // The synchronous gate swallows the hostile reader rather than throwing.
    expect(() => plugin.hooks!.onTurnEnd!(ctx)).not.toThrow();
  });

  it('is silent when the provider errors (no nudge, no throw)', async () => {
    const provider = new FakeProvider({
      name: 'fake',
      script: [[
        { type: 'message_start', model: 'fake' },
        { type: 'error', message: 'boom', retryable: false },
      ]],
    });
    const { plugin, internals } = buildReflectorPlugin();
    await plugin.hooks!.onTurnEnd!(turnCtx(busyTurn(), driverServices(provider)));
    await internals.settle(sid);
    expect(internals.pendingNudge(sid)).toBeNull();
    // Budget is still spent — one attempt was made.
    expect(internals.budget(sid)?.count).toBe(1);
  });

  it('clears per-session state on shutdown', async () => {
    const { plugin, internals } = buildReflectorPlugin();
    const ctx = turnCtx(busyTurn(), driverServices(goodReflection()));
    await plugin.hooks!.onTurnEnd!(ctx);
    await internals.settle(sid);
    expect(internals.pendingNudge(sid)).not.toBeNull();
    await plugin.hooks!.onShutdown!(ctx);
    expect(internals.pendingNudge(sid)).toBeNull();
    expect(internals.budget(sid)).toBeUndefined();
  });
});

// ── integration through a real Session (registry + provider resolution) ─────

describe('reflector integration (createFakeSession)', () => {
  let session: Session | undefined;
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('auto-adopts the default reflector and resolves it through the live registry', async () => {
    const provider = new FakeProvider({
      name: 'fake',
      script: [textReply(replyJson([{ kind: 'skill', title: 'deploy runbook', nudge: 'capture the deploy steps' }]))],
    });
    const { plugin, internals } = buildReflectorPlugin();
    session = createFakeSession({ provider, plugins: [plugin] });

    // The reflector def registered + auto-adopted through the real registry.
    expect(session.reflectors.getActiveName()).toBe('default');

    // Drive the driver against the REAL session services (reflectors + providers).
    const ctx = turnCtx(busyTurn(), session.services);
    await plugin.hooks!.onTurnEnd!(ctx);
    await internals.settle(sid);

    const nudge = internals.pendingNudge(sid);
    expect(nudge).toContain('deploy runbook');

    const injected = (await plugin.hooks!.onBeforeProviderCall!(
      { model: 'm', messages: [] },
      ctx,
    )) as ProviderRequest;
    expect(injected.system).toContain('deploy runbook');
  });
});
