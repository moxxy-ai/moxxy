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
});
