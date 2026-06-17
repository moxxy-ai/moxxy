import { describe, expect, it } from 'vitest';

import { splitConnectUrl } from './pairing.js';

describe('splitConnectUrl', () => {
  it('strips the ?t= token from a local pairing URL', () => {
    expect(splitConnectUrl('ws://192.168.1.7:8765/?t=abc123')).toEqual({
      url: 'ws://192.168.1.7:8765/',
      token: 'abc123',
    });
  });

  it('decodes a percent-encoded token (tunnel URL)', () => {
    expect(splitConnectUrl('wss://foo.trycloudflare.com/?t=a%2Bb%3D')).toEqual({
      url: 'wss://foo.trycloudflare.com/',
      token: 'a+b=',
    });
  });

  it('keeps other query params when removing the token', () => {
    expect(splitConnectUrl('ws://host:8765/?t=tok&x=1')).toEqual({
      url: 'ws://host:8765/?x=1',
      token: 'tok',
    });
  });

  it('passes a URL without a token through unchanged', () => {
    expect(splitConnectUrl('ws://127.0.0.1:8765')).toEqual({ url: 'ws://127.0.0.1:8765' });
  });

  it('connects as-is when the token escape is malformed', () => {
    expect(splitConnectUrl('ws://host:8765/?t=%zz')).toEqual({ url: 'ws://host:8765/?t=%zz' });
  });

  it('strips EVERY t= param so none leaks onto the live WS URL (hostile QR)', () => {
    // A malformed/hostile payload with two token params must not leave the
    // second `t=` riding the connect URL handed to makeWsApi.
    const out = splitConnectUrl('ws://h:1/?t=tok&t=evil');
    expect(out).toEqual({ url: 'ws://h:1/', token: 'tok' });
    expect(out.url).not.toContain('t=');
  });

  it('strips t= even between other params without leaving a dangling separator', () => {
    expect(splitConnectUrl('ws://h:1/?x=1&t=tok&y=2')).toEqual({
      url: 'ws://h:1/?x=1&y=2',
      token: 'tok',
    });
    expect(splitConnectUrl('ws://h:1/?x=1&t=tok')).toEqual({
      url: 'ws://h:1/?x=1',
      token: 'tok',
    });
  });

  it('normalizes a trailing fragment cleanly (no dangling ?#)', () => {
    const out = splitConnectUrl('ws://h:1/?t=tok#frag');
    expect(out).toEqual({ url: 'ws://h:1/#frag', token: 'tok' });
    expect(out.url).not.toContain('?#');
  });

  it('keeps a query when a fragment follows the stripped token', () => {
    expect(splitConnectUrl('ws://h:1/?x=1&t=tok#frag')).toEqual({
      url: 'ws://h:1/?x=1#frag',
      token: 'tok',
    });
  });

  it('extracts the proxy E2E fingerprint and strips both params', () => {
    expect(splitConnectUrl('wss://abc123.proxy.moxxy.ai/?t=tok&fp=PUBKEY-fp_0')).toEqual({
      url: 'wss://abc123.proxy.moxxy.ai/',
      token: 'tok',
      fingerprint: 'PUBKEY-fp_0',
    });
  });

  it('handles a fingerprint with no token', () => {
    expect(splitConnectUrl('wss://abc.proxy.moxxy.ai/?fp=KEY')).toEqual({
      url: 'wss://abc.proxy.moxxy.ai/',
      fingerprint: 'KEY',
    });
  });
});
