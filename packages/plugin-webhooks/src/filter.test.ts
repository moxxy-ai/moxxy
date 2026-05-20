import { describe, expect, it } from 'vitest';
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
});
