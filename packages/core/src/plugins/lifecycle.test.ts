import { describe, expect, it, vi } from 'vitest';
import { definePlugin, asSessionId, asTurnId, asToolCallId } from '@moxxy/sdk';
import type {
  AppContext,
  ToolCallContext,
  ToolResultContext,
  ToolResultEvent,
  TurnContext,
} from '@moxxy/sdk';
import { silentLogger } from '../logger.js';
import { HookDispatcherImpl } from './lifecycle.js';

const sid = asSessionId('s');
const tid = asTurnId('t');

const appCtx: AppContext = {
  sessionId: sid,
  cwd: '/tmp',
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  env: {},
};

const turnCtx: TurnContext = { ...appCtx, turnId: tid, iteration: 0 };

const callCtx: ToolCallContext = {
  ...turnCtx,
  call: { callId: asToolCallId('c'), name: 'X', input: {} },
};

describe('HookDispatcherImpl', () => {
  it('fires onInit in plugin registration order', async () => {
    const order: string[] = [];
    const a = definePlugin({ name: 'a', hooks: { onInit: () => void order.push('a') } });
    const b = definePlugin({ name: 'b', hooks: { onInit: () => void order.push('b') } });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([b, a]);
    await d.dispatchInit(appCtx);
    expect(order).toEqual(['b', 'a']);
  });

  it('short-circuits onToolCall on first deny', async () => {
    const calls: string[] = [];
    const allow = definePlugin({
      name: 'allow',
      hooks: {
        onToolCall: () => {
          calls.push('allow');
          return { action: 'allow' };
        },
      },
    });
    const deny = definePlugin({
      name: 'deny',
      hooks: {
        onToolCall: () => {
          calls.push('deny');
          return { action: 'deny', reason: 'no' };
        },
      },
    });
    const after = definePlugin({
      name: 'after',
      hooks: { onToolCall: () => void calls.push('after') },
    });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([allow, deny, after]);
    const verdict = await d.dispatchToolCall(callCtx);
    expect(verdict.action).toBe('deny');
    expect(calls).toEqual(['allow', 'deny']);
  });

  it('lets a later deny override an earlier rewrite (deny precedence)', async () => {
    const calls: string[] = [];
    const rewrite = definePlugin({
      name: 'rewrite',
      hooks: {
        onToolCall: () => {
          calls.push('rewrite');
          return { action: 'rewrite', input: { redacted: true } };
        },
      },
    });
    const deny = definePlugin({
      name: 'deny',
      hooks: {
        onToolCall: () => {
          calls.push('deny');
          return { action: 'deny', reason: 'blocked' };
        },
      },
    });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([rewrite, deny]);
    const verdict = await d.dispatchToolCall(callCtx);
    expect(verdict).toEqual({ action: 'deny', reason: 'blocked' });
    expect(calls).toEqual(['rewrite', 'deny']);
  });

  it('threads onToolResult through plugins so each sees the prior output', async () => {
    const baseResult: ToolResultEvent = {
      id: 'e1' as never,
      seq: 0,
      ts: 0,
      sessionId: sid,
      turnId: tid,
      source: 'tool' as never,
      type: 'tool_result',
      callId: asToolCallId('c'),
      ok: true,
      output: 'raw',
    };
    const resultCtx: ToolResultContext = { ...turnCtx, result: baseResult };
    const seen: unknown[] = [];
    const a = definePlugin({
      name: 'a',
      hooks: {
        onToolResult: (ctx) => {
          seen.push(ctx.result.output);
          return { ...ctx.result, output: `${ctx.result.output as string}-a` };
        },
      },
    });
    const b = definePlugin({
      name: 'b',
      hooks: {
        onToolResult: (ctx) => {
          // B must observe A's mutation, not the original.
          seen.push(ctx.result.output);
          return { ...ctx.result, output: `${ctx.result.output as string}-b` };
        },
      },
    });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([a, b]);
    const final = await d.dispatchToolResult(resultCtx);
    expect(seen).toEqual(['raw', 'raw-a']);
    expect(final.output).toBe('raw-a-b');
  });

  it('pipelines onBeforeProviderCall', async () => {
    const p1 = definePlugin({
      name: 'p1',
      hooks: {
        onBeforeProviderCall: (req) => ({ ...req, system: (req.system ?? '') + '[p1]' }),
      },
    });
    const p2 = definePlugin({
      name: 'p2',
      hooks: {
        onBeforeProviderCall: (req) => ({ ...req, system: (req.system ?? '') + '[p2]' }),
      },
    });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([p2, p1]);
    const out = await d.dispatchBeforeProviderCall(
      { model: 'm', messages: [], system: '' },
      turnCtx,
    );
    expect(out.system).toBe('[p2][p1]');
  });

  it('hasEventHooks reflects whether any plugin declares onEvent', () => {
    const d = new HookDispatcherImpl({ logger: silentLogger });
    expect(d.hasEventHooks()).toBe(false);
    d.setPlugins([definePlugin({ name: 'noop', hooks: { onInit: () => {} } })]);
    expect(d.hasEventHooks()).toBe(false);
    d.setPlugins([definePlugin({ name: 'listener', hooks: { onEvent: () => {} } })]);
    expect(d.hasEventHooks()).toBe(true);
  });

  it('does not surface an unhandledRejection when a hook rejects AFTER timing out', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Hook stays pending past the (tiny) timeout, THEN rejects. The dispatcher
      // must have a rejection handler attached to the hook promise so this
      // late rejection is swallowed rather than crashing the process.
      const slow = definePlugin({
        name: 'slow',
        hooks: {
          onInit: () =>
            new Promise<void>((_, reject) => {
              setTimeout(() => reject(new Error('late boom')), 30);
            }),
        },
      });
      const d = new HookDispatcherImpl({ logger: silentLogger, hookTimeoutMs: 5 });
      d.setPlugins([slow]);
      await d.dispatchInit(appCtx); // resolves on timeout, not on the late reject
      // Wait long enough for the late rejection to fire and any microtasks to
      // flush, so a missing handler would have been observed by now.
      await new Promise((r) => setTimeout(r, 60));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('logs and continues when a hook throws', async () => {
    const failed = vi.fn();
    const bad = definePlugin({
      name: 'bad',
      hooks: {
        onInit: () => {
          throw new Error('nope');
        },
      },
    });
    const good = definePlugin({ name: 'good', hooks: { onInit: () => {} } });
    const d = new HookDispatcherImpl({ logger: silentLogger, onHookFailed: failed });
    d.setPlugins([bad, good]);
    await d.dispatchInit(appCtx);
    expect(failed).toHaveBeenCalledOnce();
  });
});
