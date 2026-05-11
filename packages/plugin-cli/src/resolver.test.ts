import { describe, expect, it, vi } from 'vitest';
import { asToolCallId } from '@moxxy/sdk';
import { createInteractivePermissionResolver } from './resolver.js';

const call = (name = 'Read') => ({ callId: asToolCallId('c1'), name, input: {} });
const ctx = { sessionId: 's', toolDescription: '' };

describe('createInteractivePermissionResolver', () => {
  it('delegates to the prompt callback on first call', async () => {
    const prompt = vi.fn().mockResolvedValue({ mode: 'allow' });
    const r = createInteractivePermissionResolver({ prompt });
    expect((await r.check(call(), ctx)).mode).toBe('allow');
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('remembers allow_session for the same tool', async () => {
    const prompt = vi.fn().mockResolvedValueOnce({ mode: 'allow_session' });
    const r = createInteractivePermissionResolver({ prompt });
    expect((await r.check(call('Bash'), ctx)).mode).toBe('allow_session');
    // Second call to same tool should NOT re-prompt
    expect((await r.check(call('Bash'), ctx)).mode).toBe('allow_session');
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('does not cache deny decisions', async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce({ mode: 'deny', reason: 'no' })
      .mockResolvedValueOnce({ mode: 'allow' });
    const r = createInteractivePermissionResolver({ prompt });
    expect((await r.check(call('Write'), ctx)).mode).toBe('deny');
    expect((await r.check(call('Write'), ctx)).mode).toBe('allow');
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('caches across different tools independently', async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce({ mode: 'allow_session' })
      .mockResolvedValueOnce({ mode: 'deny', reason: 'no' });
    const r = createInteractivePermissionResolver({ prompt });
    expect((await r.check(call('A'), ctx)).mode).toBe('allow_session');
    expect((await r.check(call('B'), ctx)).mode).toBe('deny');
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('honors a custom name', () => {
    const r = createInteractivePermissionResolver({
      prompt: async () => ({ mode: 'allow' }),
      name: 'my-resolver',
    });
    expect(r.name).toBe('my-resolver');
  });
});
