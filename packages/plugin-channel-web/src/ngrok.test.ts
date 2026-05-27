import { describe, expect, it } from 'vitest';
import { parseNgrokUrl, ngrokTunnel } from './ngrok.js';

describe('parseNgrokUrl', () => {
  it('extracts the url from ngrok JSON log lines', () => {
    const line = '{"lvl":"info","msg":"started tunnel","url":"https://ab12-cd34.ngrok-free.app","addr":"http://localhost:4040"}';
    expect(parseNgrokUrl(line)).toBe('https://ab12-cd34.ngrok-free.app');
  });
  it('matches the various ngrok domains', () => {
    expect(parseNgrokUrl('url=https://x.ngrok.app')).toBe('https://x.ngrok.app');
    expect(parseNgrokUrl('url=https://x.ngrok.io')).toBe('https://x.ngrok.io');
    expect(parseNgrokUrl('url=https://x.ngrok.dev')).toBe('https://x.ngrok.dev');
  });
  it('returns null when no ngrok url present', () => {
    expect(parseNgrokUrl('starting...')).toBeNull();
    expect(parseNgrokUrl('https://example.com')).toBeNull();
  });
});

describe('ngrokTunnel def', () => {
  it('is a named provider with open + isAvailable', () => {
    expect(ngrokTunnel.name).toBe('ngrok');
    expect(typeof ngrokTunnel.open).toBe('function');
    expect(typeof ngrokTunnel.isAvailable).toBe('function');
  });
});
