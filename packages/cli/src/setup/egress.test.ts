import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MoxxyConfig } from '@moxxy/config';
import { applyEgressSettings, resetEgressForTests, resolveEgressSettings } from './egress.js';

const PROXY_VARS = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];

describe('resolveEgressSettings', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of PROXY_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of PROXY_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('uses the environment when config says nothing', () => {
    process.env.HTTPS_PROXY = 'http://env:3128';
    expect(resolveEgressSettings(undefined)).toEqual({ httpsProxy: 'http://env:3128' });
  });

  it('uses the environment for the explicit env mode', () => {
    process.env.HTTPS_PROXY = 'http://env:3128';
    const config = { network: { proxy: 'env' } } as MoxxyConfig;
    expect(resolveEgressSettings(config).httpsProxy).toBe('http://env:3128');
  });

  // A managed workstation must be able to forbid a proxy the user exported.
  it('forces direct on proxy=off even when the environment sets one', () => {
    process.env.HTTPS_PROXY = 'http://env:3128';
    const config = { network: { proxy: 'off' } } as MoxxyConfig;
    expect(resolveEgressSettings(config)).toEqual({});
  });

  // The inverse: a user must not route around the corporate proxy by clearing
  // their shell profile.
  it('a configured proxy url overrides the environment for both schemes', () => {
    process.env.HTTPS_PROXY = 'http://env:3128';
    const config = { network: { proxy: 'http://managed:8080' } } as MoxxyConfig;
    expect(resolveEgressSettings(config)).toMatchObject({
      httpProxy: 'http://managed:8080',
      httpsProxy: 'http://managed:8080',
    });
  });

  // Pinning a proxy must never silently drop a bypass the host depended on.
  it('merges config noProxy with the environment rather than replacing it', () => {
    process.env.NO_PROXY = 'localhost';
    const config = { network: { proxy: 'http://managed:8080', noProxy: '.corp.example' } } as MoxxyConfig;
    expect(resolveEgressSettings(config).noProxy).toBe('localhost,.corp.example');
  });

  it('keeps the environment bypass rules in env mode', () => {
    process.env.HTTPS_PROXY = 'http://env:3128';
    process.env.NO_PROXY = 'localhost';
    expect(resolveEgressSettings(undefined).noProxy).toBe('localhost');
  });
});

describe('applyEgressSettings', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of PROXY_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    resetEgressForTests();
  });
  afterEach(() => {
    for (const key of PROXY_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetEgressForTests();
  });

  it('reports no proxy on a clean environment', async () => {
    expect(await applyEgressSettings()).toEqual({ enabled: false, reason: 'no proxy configured' });
  });

  // Boot applies env-only settings, session setup re-applies with config. The
  // second call must not redo the work when nothing changed.
  it('is a no-op when the resolution is unchanged', async () => {
    await applyEgressSettings();
    expect(await applyEgressSettings()).toBeNull();
  });

  it('re-applies when config changes the resolution', async () => {
    await applyEgressSettings();
    const config = { network: { proxy: 'http://managed:8080' } } as MoxxyConfig;
    const status = await applyEgressSettings(config);
    expect(status).not.toBeNull();
    expect(status?.enabled).toBe(true);
    expect(status?.httpsProxy).toBe('http://managed:8080/');
  });
});
