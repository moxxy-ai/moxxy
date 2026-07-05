import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  libraryPathVar,
  resolveSherpaLibDir,
  sherpaEnv,
  sherpaPlatformPackage,
} from './platform.js';

describe('sherpaPlatformPackage', () => {
  it.each([
    ['darwin', 'arm64', 'sherpa-onnx-darwin-arm64'],
    ['darwin', 'x64', 'sherpa-onnx-darwin-x64'],
    ['linux', 'x64', 'sherpa-onnx-linux-x64'],
    ['linux', 'arm64', 'sherpa-onnx-linux-arm64'],
    ['win32', 'x64', 'sherpa-onnx-win-x64'],
  ] as const)('maps %s-%s to %s', (platform, arch, pkg) => {
    expect(sherpaPlatformPackage(platform as NodeJS.Platform, arch)).toBe(pkg);
  });

  it('returns null for an unsupported platform/arch', () => {
    expect(sherpaPlatformPackage('linux', 'ia32')).toBeNull();
    expect(sherpaPlatformPackage('freebsd', 'x64')).toBeNull();
  });
});

describe('libraryPathVar', () => {
  it('picks the platform dynamic-loader var, or null on Windows', () => {
    expect(libraryPathVar('darwin')).toBe('DYLD_LIBRARY_PATH');
    expect(libraryPathVar('linux')).toBe('LD_LIBRARY_PATH');
    expect(libraryPathVar('win32')).toBeNull();
  });
});

describe('sherpaEnv', () => {
  it('sets the loader var to the lib dir when none is present', () => {
    expect(sherpaEnv('/libs', 'darwin', {})).toEqual({ DYLD_LIBRARY_PATH: '/libs' });
    expect(sherpaEnv('/libs', 'linux', {})).toEqual({ LD_LIBRARY_PATH: '/libs' });
  });

  it('prepends the lib dir to an existing loader path', () => {
    expect(sherpaEnv('/libs', 'darwin', { DYLD_LIBRARY_PATH: '/other' })).toEqual({
      DYLD_LIBRARY_PATH: `/libs${path.delimiter}/other`,
    });
  });

  it('returns no env on Windows (DLLs resolve next to the addon)', () => {
    expect(sherpaEnv('C:\\libs', 'win32', {})).toEqual({});
  });
});

describe('resolveSherpaLibDir', () => {
  it('returns the dirname of the resolved platform package.json', () => {
    const fakeResolve = (req: string): string => {
      expect(req).toBe('sherpa-onnx-darwin-arm64/package.json');
      return '/store/sherpa-onnx-darwin-arm64/package.json';
    };
    expect(resolveSherpaLibDir('darwin', 'arm64', fakeResolve)).toBe('/store/sherpa-onnx-darwin-arm64');
  });

  it('returns null when the platform package cannot be resolved', () => {
    const throwing = (): string => {
      throw new Error('MODULE_NOT_FOUND');
    };
    expect(resolveSherpaLibDir('darwin', 'arm64', throwing)).toBeNull();
  });

  it('returns null for an unsupported platform without calling resolve', () => {
    let called = false;
    const spy = (): string => {
      called = true;
      return 'x';
    };
    expect(resolveSherpaLibDir('sunos' as NodeJS.Platform, 'x64', spy)).toBeNull();
    expect(called).toBe(false);
  });
});
