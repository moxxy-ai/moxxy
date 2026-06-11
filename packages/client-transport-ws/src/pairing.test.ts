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
});
