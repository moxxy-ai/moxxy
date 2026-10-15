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
const mobileGatewayStorePath = fileURLToPath(new URL('../src/hooks/useGatewayStore.tsx', import.meta.url).href);
const mobileAppDelegatePath = fileURLToPath(
  new URL('../ios/MoxxyMobileGateway/AppDelegate.swift', import.meta.url).href,
);
const mobileUiKitPath = fileURLToPath(new URL('../src/ui/kit.tsx', import.meta.url).href);

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

  it('builds every iOS target for the iOS 16.4 minimum of Expo SDK 57', () => {
    const podfile = readFileSync(mobilePodfilePath, 'utf8');
    const targets = [...readFileSync(mobileXcodeProjectPath, 'utf8').matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)]
      .map(([, version]) => Number(version));

    expect(podfile).toContain("podfile_properties['ios.deploymentTarget'] || '16.4'");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target).toBeGreaterThanOrEqual(16.4);
  });

  it('keeps the native iOS shell on the Expo SDK 57 template', () => {
    const podfile = readFileSync(mobilePodfilePath, 'utf8');
    const appDelegate = readFileSync(mobileAppDelegatePath, 'utf8');

    // SDK 55 removed the Legacy Architecture, so there is nothing left to switch off.
    expect(podfile).not.toContain('RCT_NEW_ARCH_ENABLED');
    expect(podfile).toContain('EXPO_USE_PRECOMPILED_MODULES');
    expect(appDelegate).toContain('internal import Expo');
    expect(appDelegate).toContain('@main');
    expect(appDelegate).not.toContain('@UIApplicationMain');
    expect(appDelegate).not.toContain('bindReactNativeFactory');
  });

  it('does not ask Android for a blur that needs a BlurTargetView it never gets', () => {
    const kit = readFileSync(mobileUiKitPath, 'utf8');

    // Since expo-blur 55 the Dimezis blur on Android renders only over a BlurTargetView.
    expect(kit).not.toContain('experimentalBlurMethod');
    expect(kit).not.toContain('dimezisBlurView');
  });

  it('keeps expo-updates resource generation working from paths with spaces', () => {
    const podfile = readFileSync(mobilePodfilePath, 'utf8');

    // The pod's own phase runs `bash -l -c "$PODS_TARGET_SRCROOT/..."`, which splits the path at a space.
    expect(podfile).toContain('patch_expo_updates_resources_phase(installer)');
    expect(podfile).toContain('bash -l "$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh"');
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

  it('reconciles mobile active turns with the live runner after missed lifecycle pushes', () => {
    const gatewayStore = readFileSync(mobileGatewayStorePath, 'utf8');

    expect(gatewayStore).toContain('ACTIVE_TURN_RECOVERY_INITIAL_MS');
    expect(gatewayStore).toContain('ACTIVE_TURN_RECOVERY_INTERVAL_MS');
    expect(gatewayStore).toContain('refresh();');
    expect(gatewayStore).toMatch(/if\s*\(\s*coreChat\.activeTurnId\s*\)/);
    expect(gatewayStore).toMatch(/setTimeout\(\s*\(\)\s*=>[\s\S]*ACTIVE_TURN_RECOVERY_INITIAL_MS/);
    expect(gatewayStore).toMatch(/setInterval\(\s*refresh\s*,\s*ACTIVE_TURN_RECOVERY_INTERVAL_MS\s*\)/);
    expect(gatewayStore).toContain("invoke('session.activeTurn', { workspaceId })");
    expect(gatewayStore).toMatch(
      /chatStore\s*\.\s*refreshLatest\(\s*workspaceId\s*,\s*live\.turnId\s*\)/,
    );
    expect(gatewayStore).toContain("AppState.addEventListener('change'");
  });
});
