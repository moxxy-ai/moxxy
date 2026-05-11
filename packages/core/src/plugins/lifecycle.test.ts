import { describe, expect, it, vi } from 'vitest';
import { definePlugin, asSessionId, asTurnId, asToolCallId } from '@moxxy/sdk';
import type { AppContext, TurnContext, ToolCallContext } from '@moxxy/sdk';
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
  it('fires onInit in topo order', async () => {
    const order: string[] = [];
    const a = definePlugin({ name: 'a', hooks: { onInit: () => void order.push('a') } });
    const b = definePlugin({ name: 'b', dependsOn: ['a'], hooks: { onInit: () => void order.push('b') } });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([b, a]);
    await d.dispatchInit(appCtx);
    expect(order).toEqual(['a', 'b']);
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
      dependsOn: ['allow'],
      hooks: {
        onToolCall: () => {
          calls.push('deny');
          return { action: 'deny', reason: 'no' };
        },
      },
    });
    const after = definePlugin({
      name: 'after',
      dependsOn: ['deny'],
      hooks: { onToolCall: () => void calls.push('after') },
    });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([allow, deny, after]);
    const verdict = await d.dispatchToolCall(callCtx);
    expect(verdict.action).toBe('deny');
    expect(calls).toEqual(['allow', 'deny']);
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
      dependsOn: ['p1'],
      hooks: {
        onBeforeProviderCall: (req) => ({ ...req, system: (req.system ?? '') + '[p2]' }),
      },
    });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    d.setPlugins([p1, p2]);
    const out = await d.dispatchBeforeProviderCall(
      { model: 'm', messages: [], system: '' },
      turnCtx,
    );
    expect(out.system).toBe('[p1][p2]');
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
    const good = definePlugin({ name: 'good', dependsOn: ['bad'], hooks: { onInit: () => {} } });
    const d = new HookDispatcherImpl({ logger: silentLogger, onHookFailed: failed });
    d.setPlugins([bad, good]);
    await d.dispatchInit(appCtx);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('detects dependency cycles', () => {
    const a = definePlugin({ name: 'a', dependsOn: ['b'] });
    const b = definePlugin({ name: 'b', dependsOn: ['a'] });
    const d = new HookDispatcherImpl({ logger: silentLogger });
    expect(() => d.setPlugins([a, b])).toThrow(/cycle/);
  });
});
