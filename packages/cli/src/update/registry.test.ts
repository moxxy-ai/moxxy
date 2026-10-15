import { describe, expect, it, vi } from 'vitest';
import { fetchLatest } from './registry.js';

describe('fetchLatest', () => {
  it('asks the registry about @moxxy/cli unless told another package', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ version: '1.2.3' }) };
    }) as unknown as typeof fetch;

    await expect(fetchLatest(undefined, { fetchImpl })).resolves.toBe('1.2.3');
    await fetchLatest('@openai/codex', { fetchImpl });
    expect(seen).toEqual([
      'https://registry.npmjs.org/%40moxxy%2Fcli/latest',
      'https://registry.npmjs.org/%40openai%2Fcodex/latest',
    ]);
  });
});
