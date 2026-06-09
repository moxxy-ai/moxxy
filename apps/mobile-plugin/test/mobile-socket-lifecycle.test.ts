import { describe, expect, it } from 'vitest';
import { shouldReconnectAfterClose } from '../mobile/src/socketLifecycle';

describe('mobile socket lifecycle', () => {
  it('does not reconnect sockets closed by React effect cleanup', () => {
    expect(shouldReconnectAfterClose({ disposed: true, current: true })).toBe(false);
  });

  it('does not reconnect a socket that is no longer the current connection', () => {
    expect(shouldReconnectAfterClose({ disposed: false, current: false })).toBe(false);
  });

  it('reconnects only the active socket after an unexpected close', () => {
    expect(shouldReconnectAfterClose({ disposed: false, current: true })).toBe(true);
  });
});
