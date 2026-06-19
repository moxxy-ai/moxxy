import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import {
  localPlugin,
  localProviderDef,
  localModels,
  DEFAULT_LOCAL_BASE_URL,
  __resetRemoteWarningsForTests,
} from './index.js';

describe('@moxxy/plugin-provider-local', () => {
  it('registers the local provider', () => {
    expect(localPlugin.providers?.map((p) => p.name)).toEqual(['local']);
  });

  it('has no validateKey (local servers do not authenticate)', () => {
    expect(localProviderDef.validateKey).toBeUndefined();
  });

  it('activates with no key — createClient supplies a placeholder and the Ollama base URL', () => {
    const client = localProviderDef.createClient({});
    expect(client.name).toBe('local');
    expect(client.models).toEqual(localModels);
    expect(DEFAULT_LOCAL_BASE_URL).toBe('http://localhost:11434/v1');
  });

  it('passes through unlisted local model ids (catalog is only a default set)', () => {
    // The catalog is short on purpose; the provider streams any model id the
    // local server knows. Sanity-check the seed catalog is non-empty.
    expect(localModels.length).toBeGreaterThan(0);
    expect(localModels.every((m) => m.supportsStreaming)).toBe(true);
  });

  it('seeds a conservative context window (never over-claims the server window)', () => {
    // Over-claiming defeats the compaction/elision budget; under-claiming is the
    // safe direction. Stock Ollama num_ctx is 2k–4k, so the seed must stay small.
    expect(localModels.every((m) => m.contextWindow <= 8_192)).toBe(true);
    expect(localModels.every((m) => m.contextWindow > 0)).toBe(true);
  });

  describe('baseURL validation (SSRF / data-egress guard)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    beforeEach(() => {
      warn.mockClear();
      __resetRemoteWarningsForTests();
      delete process.env.LOCAL_MODEL_BASE_URL;
    });
    afterEach(() => {
      delete process.env.LOCAL_MODEL_BASE_URL;
    });

    it('rejects an unparseable baseURL with a structured MoxxyError', () => {
      expect(() => localProviderDef.createClient({ baseURL: 'not a url' })).toThrow(MoxxyError);
      try {
        localProviderDef.createClient({ baseURL: '::::' });
      } catch (err) {
        expect(MoxxyError.isMoxxyError(err)).toBe(true);
        expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
      }
    });

    it.each(['file:///etc/passwd', 'gopher://evil/', 'ftp://host/x', 'data:text/plain,x'])(
      'rejects a non-http(s) scheme (%s) instead of handing it to the SDK',
      (bad) => {
        let thrown: unknown;
        try {
          localProviderDef.createClient({ baseURL: bad });
        } catch (err) {
          thrown = err;
        }
        expect(MoxxyError.isMoxxyError(thrown)).toBe(true);
        expect((thrown as MoxxyError).code).toBe('CONFIG_INVALID');
      },
    );

    it('does not warn for a loopback endpoint (the local happy path)', () => {
      localProviderDef.createClient({ baseURL: 'http://127.0.0.1:11434/v1' });
      localProviderDef.createClient({ baseURL: 'http://localhost:1234/v1' });
      localProviderDef.createClient({ baseURL: 'http://[::1]:11434/v1' });
      localProviderDef.createClient({ baseURL: 'http://dev.localhost/v1' });
      localProviderDef.createClient({ baseURL: 'http://127.5.5.5/v1' });
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      'http://localhost.evil.com/v1',
      'http://127.0.0.1.evil.com/v1',
      'http://[fe80::1]/v1',
      'http://192.168.1.50:11434/v1',
    ])('warns for a remote host that merely looks loopback-ish (%s)', (baseURL) => {
      // The dangerous direction is mis-classifying a REMOTE host as loopback and
      // silently suppressing the egress warning. These must all warn.
      localProviderDef.createClient({ baseURL });
      expect(warn).toHaveBeenCalled();
    });

    it('warns once per distinct non-loopback host so data egress is visible', () => {
      localProviderDef.createClient({ baseURL: 'https://remote.example.com/v1' });
      localProviderDef.createClient({ baseURL: 'https://remote.example.com/v2' });
      expect(warn).toHaveBeenCalledTimes(1);
      localProviderDef.createClient({ baseURL: 'http://other.example.org:8080/v1' });
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('never re-warns for an already-seen host, even past the bound (no unbounded log spam)', () => {
      // Cycle many distinct remote hosts so the warn cap is reached, then replay
      // the exact same hosts. The worst case the bound protects against is a
      // caller cycling base URLs: hosts beyond the cap must NOT re-warn on every
      // call. So the second pass over the identical hosts must emit zero warns.
      const hosts = Array.from({ length: 80 }, (_, i) => `https://spam-${i}.example.net/v1`);
      for (const baseURL of hosts) localProviderDef.createClient({ baseURL });
      const afterFirstPass = warn.mock.calls.length;
      warn.mockClear();
      for (const baseURL of hosts) localProviderDef.createClient({ baseURL });
      expect(warn).not.toHaveBeenCalled();
      // First pass is itself bounded: at most one warn per distinct host.
      expect(afterFirstPass).toBeLessThanOrEqual(hosts.length);
    });

    it('honours the LOCAL_MODEL_BASE_URL env fallback for non-CLI callers', () => {
      process.env.LOCAL_MODEL_BASE_URL = 'http://localhost:11434/v1';
      expect(() => localProviderDef.createClient({})).not.toThrow();
    });
  });
});
