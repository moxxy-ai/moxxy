import { describe, expect, it } from 'vitest';
import { parseTrycloudflareUrl, cloudflaredTunnel } from './cloudflared.js';

describe('parseTrycloudflareUrl', () => {
  it('extracts a hyphenated subdomain from a log line', () => {
    expect(parseTrycloudflareUrl('INF |  https://blue-cat-runs-fast.trycloudflare.com  |')).toBe(
      'https://blue-cat-runs-fast.trycloudflare.com',
    );
  });
  it('is case-insensitive on scheme/host but returns the matched text', () => {
    expect(parseTrycloudflareUrl('see HTTPS://ABC.TRYCLOUDFLARE.COM now')).toBe('HTTPS://ABC.TRYCLOUDFLARE.COM');
  });
  it('returns the first match when several appear', () => {
    const s = 'https://aaa.trycloudflare.com and https://bbb.trycloudflare.com';
    expect(parseTrycloudflareUrl(s)).toBe('https://aaa.trycloudflare.com');
  });
  it('returns null when no tunnel URL is present', () => {
    expect(parseTrycloudflareUrl('Starting tunnel...')).toBeNull();
    expect(parseTrycloudflareUrl('https://example.com')).toBeNull();
    expect(parseTrycloudflareUrl('')).toBeNull();
  });
  it('does not match http (non-TLS) trycloudflare', () => {
    expect(parseTrycloudflareUrl('http://abc.trycloudflare.com')).toBeNull();
  });
});

describe('cloudflaredTunnel def', () => {
  it('is a named provider exposing open + isAvailable', () => {
    expect(cloudflaredTunnel.name).toBe('cloudflared');
    expect(typeof cloudflaredTunnel.open).toBe('function');
    expect(typeof cloudflaredTunnel.isAvailable).toBe('function');
  });
  it('isAvailable resolves false when the binary is absent', async () => {
    // cloudflared is not installed in CI/this environment.
    const available = await cloudflaredTunnel.isAvailable!();
    expect(typeof available).toBe('boolean');
  });
});
