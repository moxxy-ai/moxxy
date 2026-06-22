import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mobileMetroConfigPath = fileURLToPath(new URL('../metro.config.cjs', import.meta.url).href);
const mobilePodfilePath = fileURLToPath(new URL('../ios/Podfile', import.meta.url).href);
const mobileXcodeProjectPath = fileURLToPath(
  new URL('../ios/MoxxyMobileGateway.xcodeproj/project.pbxproj', import.meta.url).href,
);

describe('mobile app build config', () => {
  it('keeps the full Expo app monorepo-aware with a single React instance', () => {
    const metroConfig = readFileSync(mobileMetroConfigPath, 'utf8');

    expect(metroConfig).toContain('watchFolders');
    expect(metroConfig).toContain('nodeModulesPaths');
    expect(metroConfig).toContain("const singletons = ['react', 'react-dom']");
    expect(metroConfig).toContain('resolveRequest');
  });

  it('keeps Expo constants manifest generation working from paths with spaces', () => {
    const podfile = readFileSync(mobilePodfilePath, 'utf8');

    expect(podfile).toContain('patch_expo_constants_manifest_phase');
    expect(podfile).toContain('moxxy-exconstants-pods');
    expect(podfile).toContain('export PROJECT_ROOT=');
  });

  it('generates the Expo constants manifest into the app bundle', () => {
    const xcodeProject = readFileSync(mobileXcodeProjectPath, 'utf8');

    expect(xcodeProject).toContain('Generate Expo Constants app.config');
    expect(xcodeProject).toContain('EXConstants.bundle/app.config');
    expect(xcodeProject).toContain('getAppConfig.js');
  });
});
