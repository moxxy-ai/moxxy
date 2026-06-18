import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldFire } from './filter.js';
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
