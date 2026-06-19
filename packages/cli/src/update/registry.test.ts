import { describe, expect, it, vi } from 'vitest';
import { fetchLatest } from './registry.js';

/** A fetch stub returning a JSON body with the given status. */
function jsonResponse(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('fetchLatest', () => {
  it('returns the version string for a 200 with {version}', async () => {
    const fetchImpl = jsonResponse(200, { version: '1.2.3' });
    await expect(fetchLatest('@moxxy/cli', { fetchImpl })).resolves.toBe('1.2.3');
  });

  it('returns null for a 200 whose body has no string version', async () => {
    await expect(fetchLatest('@moxxy/cli', { fetchImpl: jsonResponse(200, {}) })).resolves.toBeNull();
    await expect(
      fetchLatest('@moxxy/cli', { fetchImpl: jsonResponse(200, { version: 42 }) }),
    ).resolves.toBeNull();
  });

  it('returns null for a 404 (and never reads the body)', async () => {
    const json = vi.fn(async () => ({ version: 'should-not-be-read' }));
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json })) as unknown as typeof fetch;
    await expect(fetchLatest('@moxxy/cli', { fetchImpl })).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it('returns null for a 500', async () => {
    await expect(
      fetchLatest('@moxxy/cli', { fetchImpl: jsonResponse(500, {}) }),
    ).resolves.toBeNull();
  });

  it('returns null when the fetch implementation rejects (offline)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(fetchLatest('@moxxy/cli', { fetchImpl })).resolves.toBeNull();
  });

  it('encodes the package name so a hostile pkg cannot escape the registry path', async () => {
    let seenUrl = '';
    const fetchImpl = vi.fn(async (url: string) => {
      seenUrl = url;
      return { ok: true, status: 200, json: async () => ({ version: '1.0.0' }) };
    }) as unknown as typeof fetch;
    await fetchLatest('@moxxy/cli', { fetchImpl });
    expect(seenUrl).toBe('https://registry.npmjs.org/%40moxxy%2Fcli/latest');

    // A name containing traversal / a host segment must stay inside the path:
    // encodeURIComponent escapes the separators (`/` → %2F, npm's own scoped-
    // package encoding) and the query (`?` → %3F), so the hostile name becomes a
    // single inert path segment. Bare dots are harmless — what must NOT survive
    // is an unescaped `../` traversal or a raw `?` query injection.
    await fetchLatest('../../evil?x=1', { fetchImpl });
    expect(seenUrl).toBe('https://registry.npmjs.org/..%2F..%2Fevil%3Fx%3D1/latest');
    expect(seenUrl.startsWith('https://registry.npmjs.org/')).toBe(true);
    expect(seenUrl.endsWith('/latest')).toBe(true);
    expect(seenUrl).not.toContain('../');
    expect(seenUrl).not.toContain('?x=1');
    expect(seenUrl).toContain('%2F');
  });

  it('aborts and resolves null when the request outlives the timeout', async () => {
    let abortSeen = false;
    // A fetch that never resolves on its own — it only settles when the
    // AbortController fires, proving the timeout path clears nothing it
    // shouldn't and returns null fail-soft.
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          abortSeen = true;
          reject(new Error('aborted'));
        });
      });
    }) as unknown as typeof fetch;

    await expect(fetchLatest('@moxxy/cli', { fetchImpl, timeoutMs: 1 })).resolves.toBeNull();
    expect(abortSeen).toBe(true);
  });
});
