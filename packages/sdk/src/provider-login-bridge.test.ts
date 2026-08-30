import { describe, expect, it } from 'vitest';
import {
  createLoginStreamScanner,
  decodeLoginAuthUrl,
  decodeLoginPrompt,
  encodeLoginAuthUrl,
  encodeLoginPrompt,
  type LoginStreamItem,
} from './provider-login-bridge.js';

describe('encode/decode login prompt', () => {
  it('round-trips a request', () => {
    const marker = encodeLoginPrompt({ question: 'Paste token:', mask: true });
    // NUL-bracketed.
    expect(marker.startsWith('\u0000')).toBe(true);
    expect(marker.endsWith('\u0000')).toBe(true);
    const inner = marker.slice(1, -1);
    expect(decodeLoginPrompt(inner)).toEqual({ question: 'Paste token:', mask: true });
  });

  it('rejects non-marker segments', () => {
    expect(decodeLoginPrompt('just text')).toBeNull();
    expect(decodeLoginPrompt('{"tag":"other","question":"x"}')).toBeNull();
    expect(decodeLoginPrompt('{not json')).toBeNull();
  });
});

describe('encode/decode login auth URL', () => {
  const authUrl =
    'https://auth.example.test/authorize?client_id=moxxy&state=opaque&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback';

  it('round-trips a credential-free http(s) URL', () => {
    const marker = encodeLoginAuthUrl(authUrl);
    expect(marker.startsWith('\u0000')).toBe(true);
    expect(marker.endsWith('\u0000')).toBe(true);
    expect(decodeLoginAuthUrl(marker.slice(1, -1))).toBe(authUrl);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://alice:secret@auth.example.test/authorize',
  ])('rejects an unsafe URL before encoding: %s', (url) => {
    expect(() => encodeLoginAuthUrl(url)).toThrow();
  });

  it.each([
    '{"tag":"moxxy.login.auth_url","url":"file:///etc/passwd"}',
    '{"tag":"moxxy.login.auth_url","url":"https://alice:secret@auth.example.test/"}',
    '{"tag":"moxxy.login.auth_url","url":42}',
  ])('rejects a forged unsafe marker: %s', (segment) => {
    expect(decodeLoginAuthUrl(segment)).toBeNull();
  });
});

/** Drain a scanner across the given chunks into a flat item list. */
function scanAll(chunks: string[]): LoginStreamItem[] {
  const scanner = createLoginStreamScanner();
  return chunks.flatMap((c) => [...scanner.push(c)]);
}

describe('createLoginStreamScanner', () => {
  it('passes plain output straight through', () => {
    expect(scanAll(['hello world'])).toEqual([{ type: 'output', text: 'hello world' }]);
  });

  it('extracts a marker with surrounding output', () => {
    const stream = 'opening browser\n' + encodeLoginPrompt({ question: 'Paste code:', mask: false }) + 'done\n';
    expect(scanAll([stream])).toEqual([
      { type: 'output', text: 'opening browser\n' },
      { type: 'prompt', prompt: { question: 'Paste code:', mask: false } },
      { type: 'output', text: 'done\n' },
    ]);
  });

  it('reassembles a marker split across chunks', () => {
    const marker = encodeLoginPrompt({ question: 'Paste token:', mask: true });
    const mid = Math.floor(marker.length / 2);
    const items = scanAll(['prefix', marker.slice(0, mid), marker.slice(mid), 'suffix']);
    expect(items).toEqual([
      { type: 'output', text: 'prefix' },
      { type: 'prompt', prompt: { question: 'Paste token:', mask: true } },
      { type: 'output', text: 'suffix' },
    ]);
  });

  it('handles two prompts in sequence', () => {
    const a = encodeLoginPrompt({ question: 'first', mask: false });
    const b = encodeLoginPrompt({ question: 'second', mask: true });
    expect(scanAll([a + b])).toEqual([
      { type: 'prompt', prompt: { question: 'first', mask: false } },
      { type: 'prompt', prompt: { question: 'second', mask: true } },
    ]);
  });

  it('reassembles an auth_url marker and keeps it distinct from plain output', () => {
    const url = 'https://auth.example.test/authorize?state=opaque';
    const marker = encodeLoginAuthUrl(url);
    const mid = Math.floor(marker.length / 2);
    expect(scanAll(['opening\n' + marker.slice(0, mid), marker.slice(mid), 'waiting\n'])).toEqual([
      { type: 'output', text: 'opening\n' },
      { type: 'auth_url', url },
      { type: 'output', text: 'waiting\n' },
    ]);
  });

  it('holds back a lone opening NUL until its partner arrives', () => {
    const scanner = createLoginStreamScanner();
    const marker = encodeLoginPrompt({ question: 'q', mask: false });
    // Feed everything except the closing NUL: nothing should surface yet.
    expect([...scanner.push('text' + marker.slice(0, -1))]).toEqual([
      { type: 'output', text: 'text' },
    ]);
    // Closing NUL completes the marker.
    expect([...scanner.push('\u0000')]).toEqual([
      { type: 'prompt', prompt: { question: 'q', mask: false } },
    ]);
  });
});
