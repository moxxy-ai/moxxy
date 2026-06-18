import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Session } from '@moxxy/core';
import {
  asToolCallId,
  defineMode,
  definePlugin,
  defineProvider,
  defineTool,
  dispatchToolCall,
  type ModeContext,
  type ModeDef,
  type MoxxyEvent,
  type PermissionDecision,
  type ProviderDef,
} from '@moxxy/sdk';
import { buildWebhookRunner } from './webhook-runner.js';

/**
 * Verifies the webhook fire path actually enforces a trigger's
 * `allowedTools` (audit finding A4): a non-empty list must deny tools
 * outside it (as a denial result, not a crash), an empty list keeps the
 * session's full tool set, and concurrent fires with different scopes
 * must not bleed into each other (the scoping is per-fire, never a
 * mutation of the shared session).
 */

interface ToolCallRecord {
  readonly turnId: string;
  readonly tool: string;
}

interface VisibleRecord {
  readonly turnId: string;
  readonly tools: ReadonlyArray<string>;
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
        // unused — the probe mode never calls the provider
      },
      countTokens: async () => 0,
    }),
  });
}

/**
 * A mode that records which tools the model would see, then attempts to
 * run every tool in `attempts` through the real shared dispatch path
 * (hooks → permission check → execute), exactly like default/goal mode.
 */
function makeToolProbeMode(
  attempts: ReadonlyArray<string>,
  visible: VisibleRecord[],
): ModeDef {
  return defineMode({
    name: 'tool-probe',
    run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
      visible.push({ turnId: String(ctx.turnId), tools: ctx.tools.list().map((t) => t.name) });
      let i = 0;
      for (const name of attempts) {
        yield* dispatchToolCall(ctx, { id: `${String(ctx.turnId)}-${i++}`, name, input: {} }, 0);
      }
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

function buildFixture(attempts: ReadonlyArray<string> = ['web_fetch', 'bash']): {
  session: Session;
  executed: ToolCallRecord[];
  visible: VisibleRecord[];
  events: MoxxyEvent[];
} {
  const executed: ToolCallRecord[] = [];
  const visible: VisibleRecord[] = [];
  const session = new Session({ cwd: '/tmp', silent: true });
  const probeTool = (name: string) =>
    defineTool({
      name,
      description: `${name} probe`,
      inputSchema: z.object({}),
      handler: async (_input, ctx) => {
        executed.push({ turnId: String(ctx.turnId), tool: name });
        return `${name} ran`;
      },
    });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'webhook-runner-test-fixture',
      version: '0.0.0',
      providers: [makeNoopProvider()],
      modes: [makeToolProbeMode(attempts, visible)],
      tools: [probeTool('web_fetch'), probeTool('bash')],
    }),
  );
  session.providers.setActive('noop');
  session.modes.setActive('tool-probe');
  const events: MoxxyEvent[] = [];
  session.log.subscribe((e) => {
    events.push(e);
  });
  return { session, executed, visible, events };
}

describe('buildWebhookRunner allowedTools enforcement', () => {
  it('denies tools outside a non-empty allowedTools and runs the allowed ones', async () => {
    const { session, executed, visible, events } = buildFixture();
    const runner = buildWebhookRunner(session);

    const result = await runner.runPrompt({
      prompt: 'fire',
      allowedTools: ['web_fetch'],
      triggerName: 'trusted-fetch',
    });

    // The fire completed normally — a denied tool is a denial result, not a crash.
    expect(result.error).toBeUndefined();
    expect(result.text).toBe('done');

    // Only the allowed tool actually executed.
    expect(executed.map((c) => c.tool)).toEqual(['web_fetch']);

    // The model never even saw the disallowed tool.
    expect(visible[0]?.tools).toEqual(['web_fetch']);

    // The bash attempt surfaced as a resolver denial + a denied tool_result.
    const denied = events.find((e) => e.type === 'tool_call_denied');
    expect(denied).toBeDefined();
    expect(denied && 'reason' in denied ? denied.reason : '').toContain('trusted-fetch');
    const deniedResult = events.find(
      (e) => e.type === 'tool_result' && !e.ok && e.error?.kind === 'denied',
    );
    expect(deniedResult).toBeDefined();
  });

  it('empty allowedTools keeps the session full tool set (existing contract)', async () => {
    const { session, executed, visible } = buildFixture();
    const runner = buildWebhookRunner(session);

    const result = await runner.runPrompt({
      prompt: 'fire',
      allowedTools: [],
      triggerName: 'wide-open',
    });

    expect(result.error).toBeUndefined();
    expect(executed.map((c) => c.tool).sort()).toEqual(['bash', 'web_fetch']);
    expect(visible[0]?.tools).toEqual(expect.arrayContaining(['web_fetch', 'bash']));
  });

  it('concurrent fires with different scopes do not leak into each other', async () => {
    const { session, executed, visible } = buildFixture();
    const runner = buildWebhookRunner(session);

    const [a, b] = await Promise.all([
      runner.runPrompt({ prompt: 'A', allowedTools: ['web_fetch'], triggerName: 'a' }),
      runner.runPrompt({ prompt: 'B', allowedTools: ['bash'], triggerName: 'b' }),
    ]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();

    // Each turn saw exactly its own scope...
    const byTurn = new Map(visible.map((v) => [v.turnId, v.tools]));
    expect([...byTurn.values()].sort()).toEqual([['bash'], ['web_fetch']]);

    // ...and executed exactly its own allowed tool within that turn.
    for (const call of executed) {
      expect(byTurn.get(call.turnId)).toEqual([call.tool]);
    }
    expect(executed.map((c) => c.tool).sort()).toEqual(['bash', 'web_fetch']);
  });

  it('forwards the session reasoning preference through the scoped view', async () => {
    // The scoped view (non-empty allowedTools) must stay in lockstep with the
    // real session for fields it does not override. `reasoning` is read by
    // runTurn and forwarded to ModeContext; a hand-mirrored view that forgot
    // it would silently drop the preference on every scoped fire.
    let seenReasoning: ModeContext['reasoning'];
    const session = new Session({ cwd: '/tmp', silent: true });
    session.reasoning = { effort: 'high' };
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'webhook-runner-reasoning-probe',
        version: '0.0.0',
        providers: [makeNoopProvider()],
        modes: [
          defineMode({
            name: 'reasoning-probe',
            run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
              seenReasoning = ctx.reasoning;
              yield await ctx.emit({
                type: 'assistant_message',
                sessionId: ctx.sessionId,
                turnId: ctx.turnId,
                source: 'assistant',
                content: 'done',
                stopReason: 'end_turn',
              });
            },
          }),
        ],
        tools: [
          defineTool({
            name: 'web_fetch',
            description: 'probe',
            inputSchema: z.object({}),
            handler: async () => 'ran',
          }),
        ],
      }),
    );
    session.providers.setActive('noop');
    session.modes.setActive('reasoning-probe');

    const runner = buildWebhookRunner(session);
    const result = await runner.runPrompt({
      prompt: 'fire',
      allowedTools: ['web_fetch'],
      triggerName: 'reasoned',
    });
    expect(result.error).toBeUndefined();
    expect(seenReasoning).toEqual({ effort: 'high' });
  });

  it('writes the resolved model through to the real session, not the view', async () => {
    // runTurn assigns session.lastResolvedModel on the object it was handed;
    // the scoped view must propagate that write to the shared session so
    // out-of-band spawns see the current conversation model.
    const { session } = buildFixture(['web_fetch']);
    session.lastResolvedModel = null;
    const runner = buildWebhookRunner(session);
    await runner.runPrompt({
      prompt: 'fire',
      allowedTools: ['web_fetch'],
      triggerName: 'model-write',
    });
    expect(session.lastResolvedModel).toBe('noop-1');
  });

  it('surfaces the allow-list through policyCheck (the goal-mode auto-approve path)', async () => {
    // Goal mode replaces ctx.permissions with an auto-approver that consults
    // ONLY the prompt-free `policyCheck` probe before allowing. The webhook
    // allow-list must register there too, or a goal-mode fire would
    // auto-approve tools outside the trigger's allowedTools.
    const probes: Record<string, PermissionDecision | null> = {};
    const session = new Session({ cwd: '/tmp', silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'webhook-runner-policy-probe',
        version: '0.0.0',
        providers: [makeNoopProvider()],
        modes: [
          defineMode({
            name: 'policy-probe',
            run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
              for (const name of ['web_fetch', 'bash']) {
                probes[name] =
                  (await ctx.permissions.policyCheck?.(
                    { callId: asToolCallId(`pc-${name}`), name, input: {} },
                    { sessionId: String(ctx.sessionId) },
                  )) ?? null;
              }
              yield await ctx.emit({
                type: 'assistant_message',
                sessionId: ctx.sessionId,
                turnId: ctx.turnId,
                source: 'assistant',
                content: 'done',
                stopReason: 'end_turn',
              });
            },
          }),
        ],
      }),
    );
    session.providers.setActive('noop');
    session.modes.setActive('policy-probe');

    const runner = buildWebhookRunner(session);
    const result = await runner.runPrompt({
      prompt: 'fire',
      allowedTools: ['web_fetch'],
      triggerName: 'pc',
    });
    expect(result.error).toBeUndefined();

    expect(probes['bash']?.mode).toBe('deny');
    // No persisted policy rule for the allowed tool — the probe stays
    // undecided (null), which is what lets goal mode's auto-approve allow it.
    expect(probes['web_fetch']).toBeNull();
  });
});
