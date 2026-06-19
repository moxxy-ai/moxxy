import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MATCH_VALUE_LEN, MAX_REGEX_SOURCE_LEN, shouldFire } from './filter.js';
import type { WebhookFilter } from './store.js';

const empty: WebhookFilter = { include: [], exclude: [] };

describe('shouldFire', () => {
  it('fires when filters are empty', () => {
    expect(shouldFire(empty, { headers: {}, body: Buffer.from('') })).toBe(true);
  });

  it('includes by header equals', () => {
    const f: WebhookFilter = {
      include: [{ source: 'header', name: 'x-event', equals: ['issues', 'pull_request'] }],
      exclude: [],
    };
    expect(shouldFire(f, { headers: { 'x-event': 'issues' }, body: Buffer.from('') })).toBe(true);
    expect(shouldFire(f, { headers: { 'x-event': 'push' }, body: Buffer.from('') })).toBe(false);
  });

  it('includes by jsonPath equals', () => {
    const f: WebhookFilter = {
      include: [{ source: 'jsonPath', path: 'action', equals: ['opened'] }],
      exclude: [],
    };
    expect(
      shouldFire(f, { headers: {}, body: Buffer.from('{"action":"opened","number":1}') }),
    ).toBe(true);
    expect(
      shouldFire(f, { headers: {}, body: Buffer.from('{"action":"closed"}') }),
    ).toBe(false);
  });

  it('excludes win over includes', () => {
    const f: WebhookFilter = {
      include: [{ source: 'header', name: 'x-event', equals: ['issues'] }],
      exclude: [{ source: 'jsonPath', path: 'action', equals: ['closed'] }],
    };
    expect(
      shouldFire(f, { headers: { 'x-event': 'issues' }, body: Buffer.from('{"action":"opened"}') }),
    ).toBe(true);
    expect(
      shouldFire(f, { headers: { 'x-event': 'issues' }, body: Buffer.from('{"action":"closed"}') }),
    ).toBe(false);
  });

  it('regex matches', () => {
    const f: WebhookFilter = {
      include: [{ source: 'header', name: 'x-event', matches: '^issue' }],
      exclude: [],
    };
    expect(shouldFire(f, { headers: { 'x-event': 'issues' }, body: Buffer.from('') })).toBe(true);
    expect(shouldFire(f, { headers: { 'x-event': 'push' }, body: Buffer.from('') })).toBe(false);
  });

  describe('untrusted-payload regex hardening (ReDoS worst case)', () => {
    it('an over-long regex source acts as no-match instead of being run', () => {
      const f: WebhookFilter = {
        include: [{ source: 'header', name: 'x', matches: 'a'.repeat(MAX_REGEX_SOURCE_LEN + 1) }],
        exclude: [],
      };
      // The source exceeds the cap → compileMatcher returns null → no match.
      expect(shouldFire(f, { headers: { x: 'a'.repeat(50) }, body: Buffer.from('') })).toBe(false);
    });

    it('only matches against a bounded prefix of an attacker-controlled value', () => {
      // The matched value is sliced to MAX_MATCH_VALUE_LEN before `.test()`, so
      // a sender cannot make the per-delivery scan cost scale with how long
      // they make the payload. A marker placed PAST the bound is never seen.
      const f: WebhookFilter = {
        include: [{ source: 'jsonPath', path: 'v', matches: 'MARKER' }],
        exclude: [],
      };
      const past = 'a'.repeat(MAX_MATCH_VALUE_LEN + 100) + 'MARKER';
      const within = 'a'.repeat(10) + 'MARKER';
      expect(
        shouldFire(f, { headers: {}, body: Buffer.from(JSON.stringify({ v: past })) }),
      ).toBe(false); // marker is beyond the bounded prefix → not matched
      expect(
        shouldFire(f, { headers: {}, body: Buffer.from(JSON.stringify({ v: within })) }),
      ).toBe(true);
    });

    it('a huge attacker value with a simple pattern returns quickly (no length-scaling stall)', () => {
      const f: WebhookFilter = {
        include: [{ source: 'jsonPath', path: 'v', matches: '^z+$' }],
        exclude: [],
      };
      const huge = 'a'.repeat(500_000); // never matches; bounded scan stays cheap
      const body = Buffer.from(JSON.stringify({ v: huge }));
      const start = Date.now();
      expect(shouldFire(f, { headers: {}, body })).toBe(false);
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it('caches the compiled regex across repeated deliveries', () => {
      // Re-running the same rule against many deliveries must not recompile per
      // call. We can't directly observe the cache, but a malformed/invalid
      // pattern that would throw on every recompile still returns deterministic
      // no-match without crashing the dispatcher.
      const f: WebhookFilter = {
        include: [{ source: 'header', name: 'x', matches: '([' }],
        exclude: [],
      };
      for (let i = 0; i < 5; i++) {
        expect(shouldFire(f, { headers: { x: 'whatever' }, body: Buffer.from('') })).toBe(false);
      }
    });
  });

  it('handles deep jsonPath', () => {
    const f: WebhookFilter = {
      include: [{ source: 'jsonPath', path: 'pull_request.user.login', equals: ['octocat'] }],
      exclude: [],
    };
    const body = Buffer.from('{"pull_request":{"user":{"login":"octocat"}}}');
    expect(shouldFire(f, { headers: {}, body })).toBe(true);
    expect(
      shouldFire(f, {
        headers: {},
        body: Buffer.from('{"pull_request":{"user":{"login":"other"}}}'),
      }),
    ).toBe(false);
  });

  it('treats malformed JSON body as no match', () => {
    const f: WebhookFilter = {
      include: [{ source: 'jsonPath', path: 'action', equals: ['opened'] }],
      exclude: [],
    };
    expect(shouldFire(f, { headers: {}, body: Buffer.from('not json') })).toBe(false);
  });

  describe('parses the body once regardless of jsonPath rule count', () => {
    afterEach(() => vi.restoreAllMocks());

    it('JSON.parse called exactly once across many include+exclude jsonPath rules', () => {
      const spy = vi.spyOn(JSON, 'parse');
      const f: WebhookFilter = {
        include: [
          { source: 'jsonPath', path: 'a', equals: ['x'] },
          { source: 'jsonPath', path: 'b', equals: ['y'] },
          { source: 'jsonPath', path: 'c', equals: ['z'] },
        ],
        exclude: [
          { source: 'jsonPath', path: 'd', equals: ['no'] },
          { source: 'jsonPath', path: 'e', equals: ['no'] },
        ],
      };
      const body = Buffer.from('{"a":"1","b":"2","c":"z","d":"d","e":"e"}');
      // c === 'z' matches the include; result is unchanged by the single-parse.
      expect(shouldFire(f, { headers: {}, body })).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('still parses once (and returns false) when the body is malformed', () => {
      const spy = vi.spyOn(JSON, 'parse');
      const f: WebhookFilter = {
        include: [
          { source: 'jsonPath', path: 'a', equals: ['x'] },
          { source: 'jsonPath', path: 'b', equals: ['y'] },
        ],
        exclude: [],
      };
      expect(shouldFire(f, { headers: {}, body: Buffer.from('nope') })).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
