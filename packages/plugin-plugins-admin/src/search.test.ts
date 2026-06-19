import { describe, expect, it } from 'vitest';
import { searchInstallablePlugins, type FetchLike } from './search.js';

const fakeFetch = (objects: ReadonlyArray<{ name: string; description?: string; version?: string }>): FetchLike =>
  async () => ({
    ok: true,
    status: 200,
    json: async () => ({ objects: objects.map((package_) => ({ package: package_ })) }),
  });

describe('searchInstallablePlugins', () => {
  it('returns npm hits mapped to results', async () => {
    const results = await searchInstallablePlugins('notion', {
      fetchImpl: fakeFetch([
        { name: '@acme/moxxy-notion', description: 'Notion plugin', version: '1.2.0' },
      ]),
    });
    const npm = results.find((r) => r.name === '@acme/moxxy-notion');
    expect(npm).toMatchObject({
      name: '@acme/moxxy-notion',
      source: 'npm',
      version: '1.2.0',
      installSpec: '@acme/moxxy-notion',
    });
  });

  it('merges curated catalog matches and dedupes by name', async () => {
    // Query that matches the curated "virtual office" entry; npm returns the
    // SAME package name → it must not appear twice.
    const results = await searchInstallablePlugins('office', {
      fetchImpl: fakeFetch([
        { name: '@moxxy/virtual-office-plugin', description: 'dup', version: '9.9.9' },
      ]),
    });
    const office = results.filter((r) => r.name === '@moxxy/virtual-office-plugin');
    expect(office).toHaveLength(1);
    // Catalog wins (curated entry is listed first, dedupe drops the npm dup).
    expect(office[0]?.source).toBe('catalog');
  });

  it('still returns catalog matches when the network fails', async () => {
    const boom: FetchLike = async () => {
      throw new Error('offline');
    };
    const results = await searchInstallablePlugins('office', { fetchImpl: boom });
    expect(results.some((r) => r.name === '@moxxy/virtual-office-plugin')).toBe(true);
  });

  it('ignores a non-OK npm response', async () => {
    const notOk: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const results = await searchInstallablePlugins('zzz-no-catalog-match', { fetchImpl: notOk });
    expect(results).toEqual([]);
  });

  it('forwards an AbortSignal to fetch and aborts a hung request', async () => {
    let seenSignal: AbortSignal | undefined;
    const hangThenAbort: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        seenSignal = init?.signal;
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const ac = new AbortController();
    const p = searchInstallablePlugins('zzz-no-catalog-match', {
      fetchImpl: hangThenAbort,
      signal: ac.signal,
    });
    ac.abort();
    // Abort is non-fatal — degrades to the (empty) catalog matches, no throw.
    await expect(p).resolves.toEqual([]);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('skips only the malformed registry entry, keeping the valid sibling', async () => {
    const hostile: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        objects: [
          { package: { name: '@acme/good', description: 'ok', version: '1.0.0' } },
          // description as a number and version as an object — must be skipped,
          // not coerced into the result handed back to the model, and must not
          // strand the valid sibling above.
          { package: { name: '@acme/bad', description: 42, version: { x: 1 } } },
        ],
      }),
    });
    const results = await searchInstallablePlugins('zzz-no-catalog-match', { fetchImpl: hostile });
    expect(results.map((r) => r.name)).toEqual(['@acme/good']);
  });

  it('never returns more than `size` npm hits even if the mirror over-delivers', async () => {
    const flood: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        objects: Array.from({ length: 50 }, (_, i) => ({
          package: { name: `@acme/flood-${i}`, description: 'x', version: '1.0.0' },
        })),
      }),
    });
    const results = await searchInstallablePlugins('zzz-no-catalog-match', { fetchImpl: flood, size: 5 });
    expect(results.length).toBe(5);
  });
});
