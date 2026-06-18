import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkForCliUpdate, readCachedCheck, refreshCheck, compareSemver, CACHE_TTL_MS } from './check.js';

function tmpCacheFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'mox-update-')), 'update-check.json');
}

/** A fetch stub that returns the npm `/latest` manifest for a given version. */
function stubFetch(version: string | null, status = 200): typeof fetch {
  return (async () =>
    version === null
      ? new Response('nope', { status: status === 200 ? 500 : status })
      : new Response(JSON.stringify({ version }), { status: 200 })) as unknown as typeof fetch;
}

describe('compareSemver', () => {
  it('orders by major.minor.patch and ignores prerelease', () => {
    expect(compareSemver('0.5.5', '0.5.3')).toBe(1);
    expect(compareSemver('0.5.3', '0.5.5')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.5.5-beta.1', '0.5.5')).toBe(0);
  });
});

describe('checkForCliUpdate', () => {
  it('reports an available update when latest > current', async () => {
    const r = await checkForCliUpdate('0.5.3', {
      force: true,
      cacheFile: tmpCacheFile(),
      fetchImpl: stubFetch('0.5.5'),
    });
    expect(r).toEqual({ current: '0.5.3', latest: '0.5.5', updateAvailable: true });
  });

  it('reports up-to-date when current >= latest', async () => {
    const r = await checkForCliUpdate('0.5.5', {
      force: true,
      cacheFile: tmpCacheFile(),
      fetchImpl: stubFetch('0.5.5'),
    });
    expect(r?.updateAvailable).toBe(false);
  });

  it('returns null when current version is unknown', async () => {
    expect(await checkForCliUpdate(undefined, { fetchImpl: stubFetch('0.5.5') })).toBeNull();
  });

  it('serves a fresh cache without refetching', async () => {
    const cacheFile = tmpCacheFile();
    writeFileSync(cacheFile, JSON.stringify({ checkedAt: 1000, latest: '9.9.9' }));
    let fetched = false;
    const r = await checkForCliUpdate('0.5.3', {
      cacheFile,
      now: 1000 + CACHE_TTL_MS - 1,
      fetchImpl: (async () => {
        fetched = true;
        return new Response(JSON.stringify({ version: '0.5.5' }));
      }) as unknown as typeof fetch,
    });
    expect(fetched).toBe(false);
    expect(r?.latest).toBe('9.9.9');
  });

  it('refetches + recaches when the cache is stale', async () => {
    const cacheFile = tmpCacheFile();
    writeFileSync(cacheFile, JSON.stringify({ checkedAt: 1000, latest: '0.0.1' }));
    const r = await checkForCliUpdate('0.5.3', {
      cacheFile,
      now: 1000 + CACHE_TTL_MS + 1,
      fetchImpl: stubFetch('0.5.5'),
    });
    expect(r?.latest).toBe('0.5.5');
    expect(JSON.parse(readFileSync(cacheFile, 'utf8')).latest).toBe('0.5.5');
  });

  it('falls back to a stale cache when the refetch fails (offline)', async () => {
    const cacheFile = tmpCacheFile();
    writeFileSync(cacheFile, JSON.stringify({ checkedAt: 1000, latest: '0.5.4' }));
    const r = await checkForCliUpdate('0.5.3', {
      cacheFile,
      now: 1000 + CACHE_TTL_MS + 1,
      fetchImpl: stubFetch(null), // 500
    });
    expect(r?.latest).toBe('0.5.4');
  });

  it('returns null when offline with no cache', async () => {
    const r = await checkForCliUpdate('0.5.3', {
      force: true,
      cacheFile: tmpCacheFile(),
      fetchImpl: stubFetch(null),
    });
    expect(r).toBeNull();
  });
});

describe('readCachedCheck / refreshCheck', () => {
  it('readCachedCheck never hits the network and returns null without a cache', () => {
    expect(readCachedCheck('0.5.3', { cacheFile: tmpCacheFile() })).toBeNull();
  });

  it('refreshCheck writes the cache for the next launch', async () => {
    const cacheFile = tmpCacheFile();
    await refreshCheck('0.5.3', { cacheFile, fetchImpl: stubFetch('0.5.5'), now: 42 });
    const cached = readCachedCheck('0.5.3', { cacheFile });
    expect(cached).toEqual({ current: '0.5.3', latest: '0.5.5', updateAvailable: true });
  });

  it('two concurrent refreshChecks leave a parseable cache file (atomic tmp+rename)', async () => {
    // The TUI fires refreshCheck fire-and-forget while a concurrent `moxxy update`
    // can refreshCheck the same file in the same process. The shared atomic writer
    // (pid+uuid tmp) must keep them from clobbering each other's temp path.
    const cacheFile = tmpCacheFile();
    await Promise.all([
      refreshCheck('0.5.3', { cacheFile, fetchImpl: stubFetch('0.5.5'), now: 1 }),
      refreshCheck('0.5.3', { cacheFile, fetchImpl: stubFetch('0.5.6'), now: 2 }),
    ]);
    // The file must be a single valid JSON object written by one of the writers —
    // never a half-written or interleaved blob.
    const parsed = JSON.parse(readFileSync(cacheFile, 'utf8')) as { latest: string };
    expect(['0.5.5', '0.5.6']).toContain(parsed.latest);
  });
});
