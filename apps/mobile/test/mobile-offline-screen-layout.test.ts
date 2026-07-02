import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildChatListContentStyle, buildOfflineEmptyStateCopy } from '../src/chatListLayout';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('mobile chat list layout', () => {
  it('keeps the chat list padding stable around the fixed mobile header', () => {
    expect(buildChatListContentStyle({ headerHeight: 64 })).toMatchObject({
      flexGrow: 1,
      gap: 16,
      paddingHorizontal: 20,
      paddingTop: 82,
    });
    expect(buildChatListContentStyle({ headerHeight: 64, bottomInset: 18 })).toMatchObject({
      paddingBottom: 42,
    });
  });

  it('keeps a calm offline empty state copy for the chat list', () => {
    expect(buildOfflineEmptyStateCopy(true)).toEqual({
      body: 'Your chat will appear here as soon as the desktop gateway is reachable.',
      title: 'Waiting for connection',
    });
    expect(buildOfflineEmptyStateCopy(false)).toEqual({
      body: 'Pick a session from the menu or send a message to drive the same runtime from your phone.',
      title: 'Moxxy Mobile',
    });
  });
});

describe('mobile navigation architecture', () => {
  it('is drawer-centric with no bottom tab bar', () => {
    expect(existsSync(join(root, 'app/(tabs)')), 'tabs group removed').toBe(false);
    expect(existsSync(join(root, 'src/components/TabBar.tsx')), 'tab bar removed').toBe(false);
    // The home route is the chat itself, not a redirect into tabs.
    const index = read('app/index.tsx');
    expect(index).not.toContain("href=\"/chat\"");
    expect(index).toContain('<Onboarding />');
    for (const screen of ['app/index.tsx', 'app/apps.tsx', 'app/account.tsx', 'app/workflows.tsx', 'app/scheduler.tsx']) {
      expect(existsSync(join(root, screen)), screen).toBe(true);
    }
  });

  it('gates the chat home on an open pairing, not just a stored token', () => {
    const index = read('app/index.tsx');
    const onboarding = read('src/components/Onboarding.tsx');
    // A stale stored token should not drop the user into the disconnected chat
    // shell. Until the bridge is actually open, the pairing/onboarding screen
    // remains the first surface.
    expect(index).toContain('store.pairing.transportReady');
    // Onboarding must use the SHARED store pairing (not a private usePairing
    // instance) so a successful scan advances the home-screen gate.
    expect(onboarding).toContain('const { pairing } = useGatewayStore()');
    expect(onboarding).toContain('useQrScanner');
    expect(onboarding).toContain('QrScannerSheet');
    expect(onboarding).not.toContain('className=');
  });

  it('wires the chat home from fresh chrome (header, list, glass composer, drawer)', () => {
    const index = read('app/index.tsx');
    expect(index).toContain('<ChatHeader');
    expect(index).toContain('<ChatList');
    expect(index).toContain('<ChatComposer');
    expect(index).toContain('<ChatDrawer');
    expect(index).toContain('<ComposerSheet');
    // The transcript always renders; when the bridge is down it carries an
    // inline connection banner + sheet instead of a full-screen loader.
    expect(index).toContain('connectionBanner=');
    expect(index).toContain('<ConnectionSheet');
    expect(index).not.toContain('<ConnectingView');
    expect(index).not.toContain('<SplashScreen');
    expect(index).not.toContain('className=');
  });

  it('puts workspace folders + Apps/Account at the drawer, and uses a glass composer', () => {
    const drawer = read('src/components/ChatDrawer.tsx');
    const composer = read('src/components/ChatComposer.tsx');
    // Workspace folders (the histories live here) + bottom nav to Apps/Account.
    expect(drawer).toContain('buildWorkspaceSessionTreeState');
    expect(drawer).toContain("router.push(path)");
    expect(drawer).toContain("'/apps'");
    expect(drawer).toContain("'/account'");
    expect(drawer).not.toContain('className=');
    // Minimal composer: + opens options, plus a Glass material.
    expect(composer).toContain('onOpenOptions');
    expect(composer).toContain('<Glass');
    expect(composer).not.toContain('className=');
  });
});
