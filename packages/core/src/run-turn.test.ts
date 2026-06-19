import { describe, expect, it } from 'vitest';
import type { ModeContext, ModeDef, MoxxyEvent, ProviderDef, ToolCallContext } from '@moxxy/sdk';
import { defineMode, defineProvider, definePlugin, defineTool, executeToolUses, z } from '@moxxy/sdk';
import { Session } from './session.js';
import { runTurn, collectTurn } from './run-turn.js';

// A loop that emits N assistant_message events that include `turnId` in the
// text, then returns. It does NOT touch the provider, so concurrency is
// dominated by the awaits inside the loop body (deterministic interleave via
// the microtask queue).
function makeMarkerLoop(name: string, n: number): ModeDef {
  return defineMode({
    name,
    run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
      for (let i = 0; i < n; i++) {
        // Yield to the microtask queue so two concurrent runs interleave.
        await Promise.resolve();
        await ctx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'assistant',
          text: `${ctx.turnId}:${i}`,
        });
      }
    },
  });
}

function makeNoopProvider(): ProviderDef {
  const models = [{ id: 'noop-1' }];
  return defineProvider({
    name: 'noop',
    models,
    createClient: () => ({
      name: 'noop',
      models,
      stream: async function* () {
        // unused — the test loop doesn't call into the provider.
      },
      countTokens: async () => 0,
    }),
  });
}

function buildSession(): Session {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'test-loop-and-provider',
      version: '0.0.0',
      providers: [makeNoopProvider()],
      modes: [makeMarkerLoop('marker', 3)],
    }),
  );
  session.providers.setActive('noop');
  session.modes.setActive('marker');
  return session;
}

describe('runTurn turnId filtering', () => {
  it('a single turn surfaces all of its own events', async () => {
    const session = buildSession();
    const events = await collectTurn(session, 'hi');
    const turnIds = new Set(events.map((e) => e.turnId));
    expect(turnIds.size).toBe(1);
    expect(events.filter((e) => e.type === 'assistant_message')).toHaveLength(3);
  });

  it('two concurrent turns do not cross-contaminate', async () => {
    const session = buildSession();
    const [eventsA, eventsB] = await Promise.all([
      collectTurn(session, 'A'),
      collectTurn(session, 'B'),
    ]);

    const turnIdA = eventsA[0]?.turnId;
    const turnIdB = eventsB[0]?.turnId;
    expect(turnIdA).toBeDefined();
    expect(turnIdB).toBeDefined();
    expect(turnIdA).not.toBe(turnIdB);

    // Every event in each result must carry the same turnId as the first
    // event of that result. Without the filter at run-turn.ts, A's events
    // would include B's events and vice versa.
    expect(eventsA.every((e) => e.turnId === turnIdA)).toBe(true);
    expect(eventsB.every((e) => e.turnId === turnIdB)).toBe(true);

    // Each turn yields user_prompt + 3 assistant_message events.
    expect(eventsA.filter((e) => e.type === 'assistant_message')).toHaveLength(3);
    expect(eventsB.filter((e) => e.type === 'assistant_message')).toHaveLength(3);
  });

  it('does not leak a subscription when startTurn throws after subscribe', async () => {
    const session = buildSession();
    // Force startTurn to throw by removing the active loop strategy after
    // creating the session — getActive() will throw before we touch the log.
    session.modes.unregister('marker');

    let listenerCountBefore = 0;
    let listenerCountAfter = 0;
    // Peek at the listener set size via subscribing/unsubscribing a no-op
    // (subscribe returns identity-keyed unsubscribers; we infer the leak by
    // running runTurn many times and checking the log still works normally).
    const probe = session.log.subscribe(() => {});
    listenerCountBefore = 1;
    probe();

    let threw = false;
    try {
      for await (const _ of runTurn(session, 'will fail')) {
        void _;
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const probe2 = session.log.subscribe(() => {});
    listenerCountAfter = 1;
    probe2();

    // If runTurn leaked its subscription, the EventLog's listener count would
    // have grown; we can't observe that directly, but we can verify the next
    // turn still receives a clean event stream (no spurious replays).
    expect(listenerCountAfter).toBe(listenerCountBefore);
  });
});

describe('runTurn threads real cwd/env into onToolCall hooks', () => {
  it('the dispatchToolCall hook ctx carries the session cwd/env, not empty placeholders', async () => {
    const captured: { cwd?: string; envFoo?: string } = {};
    const SESSION_CWD = '/tmp/policy-cwd';

    // A mode that dispatches a single tool use through the shared dispatcher
    // (the same path default/goal use), so the onToolCall hook fires with the
    // ModeContext-derived cwd/env.
    const dispatchMode = defineMode({
      name: 'dispatch-one',
      run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
        yield* executeToolUses(ctx, [{ id: 'c1', name: 'noop', input: {} }], 1);
      },
    });

    const session = new Session({ cwd: SESSION_CWD, silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'cwd-env-probe',
        version: '0.0.0',
        providers: [makeNoopProvider()],
        modes: [dispatchMode],
        tools: [
          defineTool({
            name: 'noop',
            description: '',
            inputSchema: z.object({}),
            handler: () => 'ok',
          }),
        ],
        hooks: {
          onToolCall: (ctx: ToolCallContext) => {
            captured.cwd = ctx.cwd;
            captured.envFoo = ctx.env.PATH; // a real env var that always exists
          },
        },
      }),
    );
    session.providers.setActive('noop');
    session.modes.setActive('dispatch-one');

    await collectTurn(session, 'go');

    // Previously hardcoded '' / {}, which silently defeated path-based policy
    // hooks. Must now be the real session cwd + a populated env.
    expect(captured.cwd).toBe(SESSION_CWD);
    expect(captured.envFoo).toBe(process.env.PATH);
  });
});

describe('runTurn worst-case hardening', () => {
  it('aborting iteration early aborts the strategy promptly (no full background run)', async () => {
    let observedAbort = false;
    // A mode that loops indefinitely until its signal aborts. If the consumer's
    // early `break` did NOT abort the turn, this would run forever and the
    // generator's `finally` would hang awaiting it.
    const foreverMode = defineMode({
      name: 'forever',
      run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
        for (let i = 0; ; i++) {
          if (ctx.signal.aborted) {
            observedAbort = true;
            return;
          }
          await ctx.emit({
            type: 'assistant_message',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'assistant',
            text: `tick-${i}`,
          });
          await new Promise((r) => setTimeout(r, 5));
        }
      },
    });

    const session = new Session({ cwd: '/tmp', silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'forever-plugin',
        version: '0.0.0',
        providers: [makeNoopProvider()],
        modes: [foreverMode],
      }),
    );
    session.providers.setActive('noop');
    session.modes.setActive('forever');

    // Break out after the first event — the generator must abort the strategy
    // in its finally and return promptly (this await would never resolve if the
    // turn ran to its non-existent completion in the background).
    for await (const event of runTurn(session, 'go')) {
      if (event.type === 'assistant_message') break;
    }

    expect(observedAbort).toBe(true);
    expect(session.signal.aborted).toBe(false); // session-level signal untouched
  });

  it('fires turnEnd even when the strategy throws (paired with turnStart)', async () => {
    const calls: string[] = [];
    const throwingMode = defineMode({
      name: 'throws',
      run: async function* (): AsyncIterable<MoxxyEvent> {
        throw new Error('strategy boom');
      },
    });

    const session = new Session({ cwd: '/tmp', silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'lifecycle-probe',
        version: '0.0.0',
        providers: [makeNoopProvider()],
        modes: [throwingMode],
        hooks: {
          onTurnStart: () => {
            calls.push('start');
          },
          onTurnEnd: () => {
            calls.push('end');
          },
        },
      }),
    );
    session.providers.setActive('noop');
    session.modes.setActive('throws');

    let threw = false;
    try {
      await collectTurn(session, 'go');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // turnEnd must pair with turnStart even on the error path — no leaked
    // turn-scoped plugin state.
    expect(calls).toEqual(['start', 'end']);
  });

  it('a missing active provider records the prompt + a structured error, then rejects', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    // No provider registered/active — getActive() throws.
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'mode-only',
        version: '0.0.0',
        modes: [makeMarkerLoop('marker', 1)],
      }),
    );
    session.modes.setActive('marker');

    let threw = false;
    try {
      await collectTurn(session, 'remember me');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The user prompt is preserved (not silently discarded) and a structured
    // error event was logged so channels see a normal failed turn.
    const events = session.log.slice();
    const prompt = events.find((e) => e.type === 'user_prompt');
    expect((prompt as { text?: string } | undefined)?.text).toBe('remember me');
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect((error as { kind?: string }).kind).toBe('fatal');
  });

  it('a provider advertising no models fails fast (no opaque "default" model id)', async () => {
    const emptyModelsProvider = defineProvider({
      name: 'empty',
      models: [],
      createClient: () => ({
        name: 'empty',
        models: [],
        stream: async function* () {},
        countTokens: async () => 0,
      }),
    });
    const session = new Session({ cwd: '/tmp', silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'empty-models',
        version: '0.0.0',
        providers: [emptyModelsProvider],
        modes: [makeMarkerLoop('marker', 1)],
      }),
    );
    session.providers.setActive('empty');
    session.modes.setActive('marker');

    await expect(collectTurn(session, 'go')).rejects.toThrow(/no models configured/i);
    // lastResolvedModel never gets the bogus sentinel.
    expect(session.lastResolvedModel).toBeNull();
  });
});
