import { describe, expect, it, vi } from 'vitest';
import { pinFirstPartySpec } from './pin.js';
import { installPluginPackagePinned } from './install.js';

describe('pinFirstPartySpec', () => {
  it('pins a bare first-party name to the CLI version', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x', undefined, '1.2.3')).toBe('@moxxy/plugin-x@1.2.3');
  });

  it('an explicit version wins over the CLI version', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x', '0.9.0', '1.2.3')).toBe('@moxxy/plugin-x@0.9.0');
  });

  it('a spec already carrying a version is untouched', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x@2.0.0', undefined, '1.2.3')).toBe(
      '@moxxy/plugin-x@2.0.0',
    );
  });

  it('non-first-party packages are untouched', () => {
    expect(pinFirstPartySpec('some-pkg', undefined, '1.2.3')).toBe('some-pkg');
  });

  it('no CLI version → no pin', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x', undefined, undefined)).toBe('@moxxy/plugin-x');
  });
});

describe('installPluginPackagePinned', () => {
  it('installs the pinned spec when the pin resolves', async () => {
    const installFn = vi.fn().mockResolvedValue({ installed: '@moxxy/plugin-x@1.2.3', dir: '/p' });
    const res = await installPluginPackagePinned({
      packageName: '@moxxy/plugin-x',
      cliVersion: '1.2.3',
      installFn,
    });
    expect(installFn).toHaveBeenCalledTimes(1);
    expect(installFn).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/plugin-x@1.2.3' }),
    );
    expect(res.installed).toBe('@moxxy/plugin-x@1.2.3');
  });

  it('retries unpinned (with a warning) when an injected pin fails', async () => {
    const installFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('npm install failed (exit 1): 404 Not Found'))
      .mockResolvedValueOnce({ installed: '@moxxy/plugin-x', dir: '/p' });
    const onWarn = vi.fn();
    const res = await installPluginPackagePinned({
      packageName: '@moxxy/plugin-x',
      cliVersion: '9.9.9',
      installFn,
      onWarn,
    });
    expect(installFn).toHaveBeenCalledTimes(2);
    expect(installFn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ packageName: '@moxxy/plugin-x@9.9.9' }),
    );
    expect(installFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ packageName: '@moxxy/plugin-x' }),
    );
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]![0]).toContain('@moxxy/plugin-x@9.9.9');
    expect(res.installed).toBe('@moxxy/plugin-x');
  });

  it('never retries an explicit user version', async () => {
    const installFn = vi.fn().mockRejectedValue(new Error('404'));
    const onWarn = vi.fn();
    await expect(
      installPluginPackagePinned({
        packageName: '@moxxy/plugin-x',
        version: '0.1.0',
        cliVersion: '1.2.3',
        installFn,
        onWarn,
      }),
    ).rejects.toThrow('404');
    expect(installFn).toHaveBeenCalledTimes(1);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('never retries a third-party or already-versioned spec', async () => {
    const installFn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      installPluginPackagePinned({ packageName: 'other-pkg', cliVersion: '1.2.3', installFn }),
    ).rejects.toThrow('boom');
    await expect(
      installPluginPackagePinned({
        packageName: '@moxxy/plugin-x@2.0.0',
        cliVersion: '1.2.3',
        installFn,
      }),
    ).rejects.toThrow('boom');
    expect(installFn).toHaveBeenCalledTimes(2);
  });
});
