import { describe, expect, it } from 'vitest';
import { asToolCallId } from '@moxxy/sdk';
import {
  autoAllowResolver,
  createAllowListResolver,
  createCallbackResolver,
  denyByDefaultResolver,
} from './resolvers.js';

const call = (name = 'Read') => ({
  callId: asToolCallId('c1'),
  name,
  input: {},
});

const ctx = { sessionId: 's', toolDescription: '' };

describe('resolvers', () => {
  it('autoAllowResolver allows', async () => {
    expect((await autoAllowResolver.check(call(), ctx)).mode).toBe('allow');
  });

  it('denyByDefaultResolver denies', async () => {
    expect((await denyByDefaultResolver.check(call(), ctx)).mode).toBe('deny');
  });

  it('createAllowListResolver allows listed names', async () => {
    const r = createAllowListResolver(['Read']);
    expect((await r.check(call('Read'), ctx)).mode).toBe('allow_session');
    expect((await r.check(call('Bash'), ctx)).mode).toBe('deny');
  });

  it('createCallbackResolver delegates to callback', async () => {
    const r = createCallbackResolver({
      callback: async (c) => ({ mode: c.name === 'X' ? 'allow' : 'deny' }),
    });
    expect((await r.check(call('X'), ctx)).mode).toBe('allow');
    expect((await r.check(call('Y'), ctx)).mode).toBe('deny');
  });
});
