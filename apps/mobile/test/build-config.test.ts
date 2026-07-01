import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mobileMetroConfigPath = fileURLToPath(new URL('../metro.config.cjs', import.meta.url).href);
const mobilePodfilePath = fileURLToPath(new URL('../ios/Podfile', import.meta.url).href);
const mobileXcodeProjectPath = fileURLToPath(
  new URL('../ios/MoxxyMobileGateway.xcodeproj/project.pbxproj', import.meta.url).href,
);
const mobileAppLayoutPath = fileURLToPath(new URL('../app/_layout.tsx', import.meta.url).href);
const mobileChatRoutePath = fileURLToPath(new URL('../app/chat.tsx', import.meta.url).href);
const mobileLiveActivityWidgetPath = fileURLToPath(
  new URL('../ios/MoxxyLiveActivityExtension/MoxxyLiveActivityWidget.swift', import.meta.url).href,
);
const mobileActivityAttributesPath = fileURLToPath(
  new URL('../ios/MoxxyMobileGateway/MoxxyActivityAttributes.swift', import.meta.url).href,
);
const mobileLiveActivityBridgePath = fileURLToPath(
  new URL('../ios/MoxxyMobileGateway/MoxxyLiveActivity.swift', import.meta.url).href,
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

  it('keeps the Live Activity deep link routed to the mobile chat surface', () => {
    const layout = readFileSync(mobileAppLayoutPath, 'utf8');
    const widget = readFileSync(mobileLiveActivityWidgetPath, 'utf8');

    expect(existsSync(mobileChatRoutePath)).toBe(true);
    expect(layout).toContain('<Stack.Screen name="chat"');
    expect(widget).toContain('moxxy-mobile://chat');
  });

  it('keeps Live Activity labels in dynamic content state so workspace changes update in place', () => {
    const attributes = readFileSync(mobileActivityAttributesPath, 'utf8');
    const bridge = readFileSync(mobileLiveActivityBridgePath, 'utf8');
    const widget = readFileSync(mobileLiveActivityWidgetPath, 'utf8');

    expect(attributes).toMatch(/struct ContentState:[\s\S]*var workspaceId: String\?/);
    expect(attributes).toMatch(/struct ContentState:[\s\S]*var title: String\?/);
    expect(attributes).toMatch(/struct ContentState:[\s\S]*var subtitle: String\?/);
    expect(bridge).toContain('workspaceId: workspaceId');
    expect(bridge).toContain('title: title');
    expect(bridge).toContain('subtitle: subtitle');
    expect(widget).toContain('context.state.title');
    expect(widget).toContain('context.state.subtitle');
  });

  it('keeps the Live Activity lock-screen badge compact and truncates detail text', () => {
    const widget = readFileSync(mobileLiveActivityWidgetPath, 'utf8');

    expect(widget).toContain('activityDetail(for: context.state)');
    expect(widget).toContain('compactStatusLabel(for: context.state)');
    expect(widget).toContain('.truncationMode(.tail)');
    expect(widget).toContain('.minimumScaleFactor');
    expect(widget).not.toContain('Text(percent(context.state.progress))');
  });

  it('ends duplicate native Live Activities for the same session', () => {
    const bridge = readFileSync(mobileLiveActivityBridgePath, 'utf8');

    expect(bridge).toContain('activities(forSessionId:');
    expect(bridge).toContain('endDuplicateActivities');
    expect(bridge).toMatch(/for activity in activities\(forSessionId:[\s\S]*await activity\.end/);
  });
});
