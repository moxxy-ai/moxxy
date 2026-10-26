import { describe, expect, it, vi } from 'vitest';
import { asToolCallId } from '@moxxy/sdk';
import { TelegramPermissionResolver } from './permission.js';

const call = (name = 'Read') => ({ callId: asToolCallId('c1'), name, input: {} });
const ctx = { sessionId: 's', toolDescription: '' };

describe('TelegramPermissionResolver', () => {
  it('denies when no decider is attached', async () => {
    const r = new TelegramPermissionResolver();
    expect((await r.check(call(), ctx)).mode).toBe('deny');
  });

  it('routes to the decider, awaits resolvePending', async () => {
    const r = new TelegramPermissionResolver();
    r.setDecider(async () => {});
    const promise = r.check(call(), ctx);
    const resolved = r.resolvePending('c1', { mode: 'allow' });
    expect(resolved).toBe(true);
    expect((await promise).mode).toBe('allow');
  });

  it('caches allow_session and skips the decider on subsequent calls', async () => {
    const r = new TelegramPermissionResolver();
    const decider = vi.fn(async () => {});
    r.setDecider(decider);
    const p1 = r.check(call('Bash'), ctx);
    r.resolvePending('c1', { mode: 'allow_session' });
    expect((await p1).mode).toBe('allow_session');

    // Second call to Bash should not hit the decider
    const p2 = r.check(call('Bash'), ctx);
    expect((await p2).mode).toBe('allow_session');
    expect(decider).toHaveBeenCalledTimes(1);
  });

  // Allowing Safari for the session must not let a later request for Terminal through.
  it('remembers allow_session only for the same request when the tool narrows it', async () => {
    const r = new TelegramPermissionResolver();
    const decider = vi.fn(async () => {});
    r.setDecider(decider);
    const narrowed = { ...ctx, toolPermission: { action: 'prompt' as const, sessionScope: { inputKeys: ['apps'] } } };
    const access = (apps: string[], id: string) => ({ callId: asToolCallId(id), name: 'computer_request_access', input: { apps } });

    const first = r.check(access(['Safari'], 'a1'), narrowed);
    r.resolvePending('a1', { mode: 'allow_session' });
    await first;
    await r.check(access(['Safari'], 'a2'), narrowed);
    expect(decider).toHaveBeenCalledTimes(1);

    void r.check(access(['Terminal'], 'a3'), narrowed);
    await vi.waitFor(() => expect(decider).toHaveBeenCalledTimes(2));
    r.abortAll();
  });

  it('abortAll resolves pending checks as deny', async () => {
    const r = new TelegramPermissionResolver();
    r.setDecider(async () => {});
    const promise = r.check(call(), ctx);
    r.abortAll('shutdown');
    const decision = await promise;
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toContain('shutdown');
  });

  it('decider throw → deny with the error message', async () => {
    const r = new TelegramPermissionResolver();
    r.setDecider(async () => {
      throw new Error('boom');
    });
    const decision = await r.check(call(), ctx);
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toContain('boom');
  });
});
