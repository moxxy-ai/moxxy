import { describe, expect, it } from 'vitest';
import type { ModeContext, ModeDef, MoxxyEvent, ProviderDef } from '@moxxy/sdk';
import { defineMode, defineProvider, definePlugin } from '@moxxy/sdk';
import { Session } from '../session.js';
import { continueChildTurn, runChildTurn, type SubagentRuntime } from './run-child.js';
import { clearRetainedChildren } from './registry.js';

// A mode that reports the model it was handed — lets tests observe the
// child's EFFECTIVE model through the returned result text.
function makeEchoModelMode(): ModeDef {
  return defineMode({
    name: 'echo-model',
    run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
      await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'assistant',
        content: ctx.model,
        stopReason: 'end_turn',
      });
    },
  });
}

// A mode that spawns a grandchild (no model override) and reports what model
// the grandchild ran on — exercises nested-spawner model inheritance.
function makeNestedSpawnMode(): ModeDef {
  return defineMode({
    name: 'nested-spawn',
    run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
      const result = await ctx.subagents!.spawn({ prompt: 'echo', mode: 'echo-model' });
      await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'assistant',
        content: result.text,
        stopReason: 'end_turn',
      });
    },
  });
}

function makeProvider(modelIds: ReadonlyArray<string>): ProviderDef {
  const models = modelIds.map((id) => ({ id }));
  return defineProvider({
    name: 'listed',
    models,
    createClient: () => ({
      name: 'listed',
      models,
      stream: async function* () {
        // unused — the test modes don't call into the provider.
      },
      countTokens: async () => 0,
    }),
  });
}

function buildSession(modelIds: ReadonlyArray<string>): Session {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'test-subagent-models',
      version: '0.0.0',
      providers: [makeProvider(modelIds)],
      modes: [makeEchoModelMode(), makeNestedSpawnMode()],
    }),
  );
  session.providers.setActive('listed');
  session.modes.setActive('echo-model');
  return session;
}

function buildRuntime(session: Session, parentModel: string): SubagentRuntime {
  return {
    parentSession: session,
    parentTurnId: session.startTurn().turnId,
    parentSignal: new AbortController().signal,
    parentModel,
  };
}

function collectParentEvents(session: Session): MoxxyEvent[] {
  const events: MoxxyEvent[] = [];
  session.log.subscribe((e) => void events.push(e));
  return events;
}

function findWarning(events: ReadonlyArray<MoxxyEvent>): string | undefined {
  const evt = events.find((e) => e.type === 'plugin_event' && e.subtype === 'subagent_warning');
  return evt?.type === 'plugin_event' ? (evt.payload as { message: string }).message : undefined;
}

describe('runChildTurn model resolution', () => {
  it('falls back to the parent model (with a warning) on an unknown model id', async () => {
    const session = buildSession(['parent-model', 'cheap-model']);
    const events = collectParentEvents(session);
    const rt = buildRuntime(session, 'parent-model');

    const result = await runChildTurn({
      rt,
      spec: { prompt: 'echo', mode: 'echo-model', model: 'claude-3-5-sonnet' },
      retainSession: false,
    });

    expect(result.text).toBe('parent-model');
    expect(findWarning(events)).toBe(
      'unknown model "claude-3-5-sonnet" — falling back to parent model "parent-model"',
    );
  });

  it('honors a model id the active provider lists, without warning', async () => {
    const session = buildSession(['parent-model', 'cheap-model']);
    const events = collectParentEvents(session);
    const rt = buildRuntime(session, 'parent-model');

    const result = await runChildTurn({
      rt,
      spec: { prompt: 'echo', mode: 'echo-model', model: 'cheap-model' },
      retainSession: false,
    });

    expect(result.text).toBe('cheap-model');
    expect(findWarning(events)).toBeUndefined();
  });

  it('inherits the parent model when no override is given', async () => {
    const session = buildSession(['parent-model']);
    const rt = buildRuntime(session, 'parent-model');

    const result = await runChildTurn({
      rt,
      spec: { prompt: 'echo', mode: 'echo-model' },
      retainSession: false,
    });

    expect(result.text).toBe('parent-model');
  });

  it('skips validation when the provider publishes no models (sparse providers)', async () => {
    const session = buildSession([]);
    const events = collectParentEvents(session);
    const rt = buildRuntime(session, 'parent-model');

    const result = await runChildTurn({
      rt,
      spec: { prompt: 'echo', mode: 'echo-model', model: 'unlisted-but-real' },
      retainSession: false,
    });

    expect(result.text).toBe('unlisted-but-real');
    expect(findWarning(events)).toBeUndefined();
  });

  it('does not warn when the override IS the parent model, even if unlisted', async () => {
    const session = buildSession(['some-other-model']);
    const events = collectParentEvents(session);
    const rt = buildRuntime(session, 'unlisted-parent');

    const result = await runChildTurn({
      rt,
      spec: { prompt: 'echo', mode: 'echo-model', model: 'unlisted-parent' },
      retainSession: false,
    });

    expect(result.text).toBe('unlisted-parent');
    expect(findWarning(events)).toBeUndefined();
  });

  it('grandchildren inherit the child effective model, not the grandparent model', async () => {
    const session = buildSession(['parent-model', 'cheap-model']);
    const rt = buildRuntime(session, 'parent-model');

    const result = await runChildTurn({
      rt,
      spec: { prompt: 'spawn nested', mode: 'nested-spawn', model: 'cheap-model' },
      retainSession: false,
    });

    // The grandchild echoes its own ctx.model — it must see the child's
    // resolved model ('cheap-model'), not the original parent's.
    expect(result.text).toBe('cheap-model');
  });
});

// A mode that runs instantly on its FIRST invocation but blocks on an external
// gate on every later turn — lets a test hold a continue() turn mid-flight while
// a second continue() races it (without hanging the initial spawn).
function makeGatedMode(gate: Promise<void>): ModeDef {
  let calls = 0;
  return defineMode({
    name: 'gated',
    run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
      calls += 1;
      if (calls > 1) await gate;
      await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'assistant',
        content: 'done',
        stopReason: 'end_turn',
      });
    },
  });
}

describe('continueChildTurn re-entrancy', () => {
  it('rejects a concurrent continue() for the same retained child (claim-then-run)', async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const session = new Session({ cwd: '/tmp', silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'gated-test',
        version: '0.0.0',
        providers: [makeProvider(['m'])],
        modes: [makeGatedMode(gate)],
      }),
    );
    session.providers.setActive('listed');
    session.modes.setActive('gated');

    const rt = buildRuntime(session, 'm');
    const first = await runChildTurn({
      rt,
      spec: { prompt: 'go', mode: 'gated', retainSession: true },
      retainSession: true,
    });
    const childId = first.childSessionId;

    // Start the first continue (blocks inside the gated mode), then race a
    // second continue for the same id before the first settles.
    const p1 = continueChildTurn({ childSessionId: childId, prompt: 'again' });
    // The entry is claimed synchronously, so the second continue must fail fast.
    await expect(
      continueChildTurn({ childSessionId: childId, prompt: 'race' }),
    ).rejects.toThrow(/no retained subagent session/);

    openGate();
    const r1 = await p1;
    expect(r1.text).toBe('done');

    clearRetainedChildren(session.id);
  });
});
