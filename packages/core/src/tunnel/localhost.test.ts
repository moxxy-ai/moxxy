import { describe, expect, it } from 'vitest';
import { localhostTunnel } from './localhost.js';

describe('localhostTunnel', () => {
  it('returns the local URL and a no-op close', async () => {
    const handle = await localhostTunnel.open({ host: '127.0.0.1', port: 4040 });
    expect(handle.url).toBe('http://127.0.0.1:4040');
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('brackets an IPv6 literal host so the URL is valid', async () => {
    // u49-1: a bare IPv6 host yields an ambiguous, unparseable URL.
    const handle = await localhostTunnel.open({ host: '::1', port: 4040 });
    expect(handle.url).toBe('http://[::1]:4040');
    // …and the result actually parses.
    expect(new URL(handle.url).hostname).toBe('[::1]');
  });

  it('is always available', async () => {
    expect(await localhostTunnel.isAvailable?.()).toBe(true);
  });
});
