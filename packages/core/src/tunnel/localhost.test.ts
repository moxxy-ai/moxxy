import { describe, expect, it } from 'vitest';
import { localhostTunnel } from './localhost.js';

describe('localhostTunnel', () => {
  it('returns the local URL and a no-op close', async () => {
    const handle = await localhostTunnel.open({ host: '127.0.0.1', port: 4040 });
    expect(handle.url).toBe('http://127.0.0.1:4040');
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('is always available', async () => {
    expect(await localhostTunnel.isAvailable?.()).toBe(true);
  });
});
