import { describe, expect, it } from 'vitest';
import {
  MoxxyError,
  classifyHttpStatus,
  classifyNetworkError,
} from './errors.js';
import { toFriendlyError } from './provider-utils.js';

describe('MoxxyError', () => {
  it('carries code, message, hint, context, cause', () => {
    const cause = new Error('underlying');
    const err = new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: 'down',
      hint: 'check',
      context: { url: 'https://x' },
      cause,
    });
    expect(err.code).toBe('NETWORK_UNREACHABLE');
    expect(err.message).toBe('down');
    expect(err.hint).toBe('check');
    expect(err.context).toEqual({ url: 'https://x' });
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('MoxxyError');
  });

  it('isMoxxyError matches instances and name-tagged clones', () => {
    const real = new MoxxyError({ code: 'INTERNAL', message: 'x' });
    expect(MoxxyError.isMoxxyError(real)).toBe(true);
    const fake = new Error('y');
    fake.name = 'MoxxyError';
    expect(MoxxyError.isMoxxyError(fake)).toBe(true);
    expect(MoxxyError.isMoxxyError(new Error('z'))).toBe(false);
    expect(MoxxyError.isMoxxyError('not an error')).toBe(false);
  });

  it('wrap() returns the original MoxxyError unchanged', () => {
    const real = new MoxxyError({ code: 'AUTH_INVALID', message: 'no' });
    const wrapped = MoxxyError.wrap(real, { code: 'INTERNAL', message: 'override' });
    expect(wrapped).toBe(real);
  });

  it('wrap() upgrades an unknown error and stores the cause', () => {
    const cause = new Error('boom');
    const wrapped = MoxxyError.wrap(cause, {
      code: 'NETWORK_UNREACHABLE',
      message: 'wrapped',
    });
    expect(wrapped).toBeInstanceOf(MoxxyError);
    expect(wrapped.code).toBe('NETWORK_UNREACHABLE');
    expect(wrapped.cause).toBe(cause);
  });
});

describe('classifyNetworkError', () => {
  // Node's fetch nests the real reason in err.cause; build a fake of that shape.
  function nodeFetchError(causeCode: string): Error {
    const cause = new Error('inner') as Error & { code: string };
    cause.code = causeCode;
    return new TypeError('fetch failed', { cause });
  }

  it('returns null for non-Error values', () => {
    expect(classifyNetworkError('nope')).toBeNull();
    expect(classifyNetworkError(null)).toBeNull();
  });

  it('passes through an existing MoxxyError', () => {
    const existing = new MoxxyError({ code: 'AUTH_INVALID', message: 'pre' });
    expect(classifyNetworkError(existing)).toBe(existing);
  });

  it('maps ENOTFOUND to NETWORK_UNREACHABLE with a DNS-flavored hint', () => {
    const out = classifyNetworkError(nodeFetchError('ENOTFOUND'), {
      url: 'https://api.example.com/v1',
    });
    expect(out).not.toBeNull();
    expect(out!.code).toBe('NETWORK_UNREACHABLE');
    expect(out!.message).toContain('api.example.com');
    expect(out!.hint).toMatch(/DNS|internet connection/i);
  });

  it('maps ECONNREFUSED to NETWORK_UNREACHABLE', () => {
    const out = classifyNetworkError(nodeFetchError('ECONNREFUSED'), {
      url: 'http://localhost:9999',
    });
    expect(out!.code).toBe('NETWORK_UNREACHABLE');
    expect(out!.message).toContain('localhost');
  });

  it('maps ETIMEDOUT to NETWORK_TIMEOUT', () => {
    const out = classifyNetworkError(nodeFetchError('ETIMEDOUT'), {
      url: 'https://x.test',
    });
    expect(out!.code).toBe('NETWORK_TIMEOUT');
  });

  it('maps CERT_HAS_EXPIRED to NETWORK_TLS_FAILURE', () => {
    const out = classifyNetworkError(nodeFetchError('CERT_HAS_EXPIRED'), {
      url: 'https://x.test',
    });
    expect(out!.code).toBe('NETWORK_TLS_FAILURE');
  });

  it('maps AbortError to NETWORK_ABORTED', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    const out = classifyNetworkError(e, { url: 'https://x.test' });
    expect(out!.code).toBe('NETWORK_ABORTED');
  });

  it('falls back when the message matches "fetch failed" but cause has no code', () => {
    const out = classifyNetworkError(new TypeError('fetch failed'), { url: 'https://x.test' });
    expect(out!.code).toBe('NETWORK_UNREACHABLE');
  });

  it('returns null for non-network errors so other handlers can take over', () => {
    expect(classifyNetworkError(new Error('something else'))).toBeNull();
  });

  it('does not throw on a malformed/relative ctx.url — degrades to the raw string', () => {
    // A bad base URL must not make `new URL()` throw from inside the classifier
    // and mask the real network error.
    expect(() =>
      classifyNetworkError(nodeFetchError('ECONNREFUSED'), { url: 'not a url' }),
    ).not.toThrow();
    const out = classifyNetworkError(nodeFetchError('ECONNREFUSED'), { url: '/relative/path' });
    expect(out!.code).toBe('NETWORK_UNREACHABLE');
    expect(out!.message).toContain('/relative/path');
    expect(out!.context).toEqual({ url: '/relative/path' });
  });
});

describe('classifyHttpStatus', () => {
  it('401 → AUTH_INVALID with a login hint', () => {
    const out = classifyHttpStatus(401, { provider: 'anthropic' });
    expect(out!.code).toBe('AUTH_INVALID');
    expect(out!.hint).toMatch(/anthropic/);
  });

  it('403 → AUTH_DENIED', () => {
    expect(classifyHttpStatus(403)!.code).toBe('AUTH_DENIED');
  });

  it('429 → PROVIDER_RATE_LIMITED', () => {
    expect(classifyHttpStatus(429)!.code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('5xx → PROVIDER_SERVER_ERROR', () => {
    expect(classifyHttpStatus(503)!.code).toBe('PROVIDER_SERVER_ERROR');
  });

  it('400 → PROVIDER_BAD_REQUEST and echoes the body', () => {
    const out = classifyHttpStatus(400, { body: 'tools array empty' });
    expect(out!.code).toBe('PROVIDER_BAD_REQUEST');
    expect(out!.message).toContain('tools array empty');
  });

  it('returns null for unmapped statuses (404, 418)', () => {
    expect(classifyHttpStatus(404)).toBeNull();
    expect(classifyHttpStatus(418)).toBeNull();
  });

  it('does not throw on a malformed ctx.url — degrades to the raw string', () => {
    expect(() => classifyHttpStatus(401, { url: 'not a url' })).not.toThrow();
    const out = classifyHttpStatus(401, { url: 'not a url' });
    expect(out!.code).toBe('AUTH_INVALID');
    expect(out!.message).toContain('not a url');
  });
});

describe('toFriendlyError', () => {
  function nodeFetchError(causeCode: string): Error {
    const cause = new Error('inner') as Error & { code: string };
    cause.code = causeCode;
    return new TypeError('fetch failed', { cause });
  }

  it('upgrades "fetch failed" into a friendly classified message', () => {
    const out = toFriendlyError(nodeFetchError('ENOTFOUND'), {
      url: 'https://api.anthropic.com/v1',
      provider: 'anthropic',
    });
    expect(out.message).not.toBe('fetch failed');
    expect(out.message).toContain('api.anthropic.com');
    expect(out.message).toMatch(/DNS|internet connection/i);
    expect(out.retryable).toBe(true);
  });

  it('passes raw messages through when not network-shaped', () => {
    const out = toFriendlyError(new Error('Unexpected response shape'));
    expect(out.message).toBe('Unexpected response shape');
    expect(out.retryable).toBe(false);
  });
});
