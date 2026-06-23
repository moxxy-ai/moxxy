import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildChatListContentStyle, buildOfflineEmptyStateCopy } from '../src/chatListLayout';
import { buildWaitingRoomUi, shouldShowWaitingRoom } from '../src/waitingRoomUi';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe('mobile offline gateway screen layout', () => {
  it('renders the gateway guidance inside the chat list instead of as an absolute overlay', async () => {
    const chatScreen = await readFile(join(root, 'app', 'chat.tsx'), 'utf8');
    const chatList = await readFile(join(root, 'src', 'components', 'ChatList.tsx'), 'utf8');

    expect(chatScreen).toContain('connectionBanner={connectionBanner}');
    expect(chatScreen).not.toContain('className="absolute z-10"');
    expect(chatList).toContain('readonly connectionBanner?: ReactNode');
    expect(chatList).toContain('ListHeaderComponent={header}');
  });

  it('keeps the offline guidance styled without depending on NativeWind class extraction', async () => {
    const banner = await readFile(
      join(root, 'src', 'components', 'ConnectionBanner.tsx'),
      'utf8',
    );

    expect(banner).toContain('StyleSheet.create');
    expect(banner).toContain('style={styles.card}');
    expect(banner).not.toContain('className=');
  });

  it('keeps the gateway pairing route styled without depending on NativeWind class extraction', async () => {
    const settingsScreen = await readFile(join(root, 'app', 'settings.tsx'), 'utf8');
    const shell = await readFile(join(root, 'src', 'components', 'AppShell.tsx'), 'utf8');
    const frame = await readFile(join(root, 'src', 'components', 'ScreenFrame.tsx'), 'utf8');
    const topBar = await readFile(join(root, 'src', 'components', 'TopBar.tsx'), 'utf8');
    const connectionSettings = await readFile(
      join(root, 'src', 'components', 'ConnectionSettings.tsx'),
      'utf8',
    );
    const qrScanner = await readFile(
      join(root, 'src', 'components', 'QrScannerSheet.tsx'),
      'utf8',
    );

    for (const source of [settingsScreen, shell, frame, topBar, connectionSettings, qrScanner]) {
      expect(source).toContain('StyleSheet.create');
      expect(source).not.toContain('className=');
    }

    expect(connectionSettings).toContain('styles.scanButton');
    expect(qrScanner).toContain('style={styles.sheet}');
    expect(frame).toContain('contentContainerStyle={styles.scrollContent}');
  });

  it('keeps the mobile menu styled without depending on NativeWind class extraction', async () => {
    const menuSheet = await readFile(
      join(root, 'src', 'components', 'MobileMenuSheet.tsx'),
      'utf8',
    );
    const workspaceTree = await readFile(
      join(root, 'src', 'components', 'WorkspaceSessionTree.tsx'),
      'utf8',
    );

    for (const source of [menuSheet, workspaceTree]) {
      expect(source).toContain('StyleSheet.create');
      expect(source).not.toContain('className=');
    }

    expect(menuSheet).toContain('styles.sheet');
    expect(menuSheet).toContain('style={styles.closeButton}');
    expect(workspaceTree).toContain('styles.sessionButtonActive');
    expect(workspaceTree).toContain('style={styles.emptyCard}');
  });

  it('keeps QR scanner controls outside the live camera preview', async () => {
    const qrScanner = await readFile(
      join(root, 'src', 'components', 'QrScannerSheet.tsx'),
      'utf8',
    );

    // The camera lives in its own dark card…
    expect(qrScanner).toContain("backgroundColor: '#020617'");
    expect(qrScanner).toContain('style={styles.cameraCard}');
    // …and the interactive controls (live status + cancel) render OUTSIDE it.
    expect(qrScanner).toContain('style={styles.statusPill}');
    expect(qrScanner).toContain('style={styles.cancelButton}');
    // Scanning is live/auto — it detects on open, with no oversized fixed
    // preview and no manual "Scan QR code" arm button floating over the camera.
    expect(qrScanner).toContain('onBarcodeScanned');
    expect(qrScanner).not.toContain('maxHeight: 390');
    expect(qrScanner).not.toContain('minHeight: 286');
    expect(qrScanner).not.toContain('styles.cameraActionArea');
    expect(qrScanner).not.toContain("'Scan QR code'");
  });

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

  it('shows a calm empty state below the offline gateway guidance', () => {
    expect(buildOfflineEmptyStateCopy(true)).toEqual({
      body: 'Your chat will appear here as soon as the desktop gateway is reachable.',
      title: 'Waiting for connection',
    });
    expect(buildOfflineEmptyStateCopy(false)).toEqual({
      body: 'Pick a session from the menu or send a message to drive the same runtime from your phone.',
      title: 'Moxxy Mobile',
    });
  });

  it('uses fixed touch targets for the floating chat header controls', async () => {
    const header = await readFile(
      join(root, 'src', 'components', 'FloatingChatHeader.tsx'),
      'utf8',
    );

    expect(header).toContain('StyleSheet.create');
    expect(header).toContain('style={styles.menuButton}');
    expect(header).toContain('style={styles.actionButton}');
    expect(header).toContain('height: 44');
    expect(header).toContain('width: 44');
  });

  it('renders a branded waiting room instead of the disabled chat composer while offline', async () => {
    const chatScreen = await readFile(join(root, 'app', 'chat.tsx'), 'utf8');
    const settingsScreen = await readFile(join(root, 'app', 'settings.tsx'), 'utf8');
    const waitingRoom = await readFile(
      join(root, 'src', 'components', 'WaitingRoom.tsx'),
      'utf8',
    );
    const pairedUi = buildWaitingRoomUi({ paired: true, status: 'closed' });
    const unpairedUi = buildWaitingRoomUi({ paired: false, status: 'idle' });

    expect(shouldShowWaitingRoom(true)).toBe(true);
    expect(shouldShowWaitingRoom(false)).toBe(false);
    expect(pairedUi.title).toBe('Waiting for the desktop gateway');
    expect(unpairedUi.steps).toContain('Open Moxxy Desktop on your Mac.');
    expect(chatScreen).toContain('showWaitingRoom ?');
    expect(chatScreen).toContain('!showWaitingRoom ? (');
    expect(chatScreen).toContain("title={showWaitingRoom ? 'Gateway' : 'Chat'}");
    expect(chatScreen).toContain('<WaitingRoom');
    expect(chatScreen).toContain('waitingRoomUi={waitingRoomUi}');
    expect(chatScreen).toContain('onOpenPairing={openPairing}');
    expect(chatScreen).toContain('openWaitingRoomPairing({');
    expect(chatScreen).toContain('navigateToScanner: router.push');
    expect(chatScreen).toContain('open={showWaitingRoom ? false : chrome.menuOpen}');
    expect(chatScreen).toContain('showMenuButton={!showWaitingRoom}');
    expect(chatScreen).toContain('showSessionActions={!showWaitingRoom}');
    expect(chatScreen).not.toContain('isGatewayPairingAvailable');
    expect(chatScreen).not.toContain('Turn on Moxxy Mobile gateway');
    expect(chatScreen).not.toContain('pairingProbePending');
    expect(settingsScreen).toContain('useLocalSearchParams');
    expect(settingsScreen).toContain("params.scan !== '1'");
    expect(settingsScreen).toContain('void qrScanner.openScanner()');
    expect(waitingRoom).toContain('moxxy-mascot-transparent.png');
    expect(waitingRoom).toContain('accessibilityLabel="Moxxy assistant mascot waving"');
    expect(waitingRoom).toContain('accessibilityLabel="Open gateway pairing and scan QR code"');
    expect(waitingRoom).toContain('waitingRoomUi.actionLabel');
    expect(waitingRoom).not.toContain('pairingPending');
    expect(waitingRoom).not.toContain('Checking gateway...');
    expect(waitingRoom).not.toContain('disabled={pairingPending}');
    expect(waitingRoom).toContain('onPress={onOpenPairing}');
    expect(waitingRoom).toContain('styles.primaryAction');
    expect(waitingRoom).toContain('style={styles.contentStack}');
    expect(waitingRoom).toContain("alignSelf: 'center'");
    expect(waitingRoom).toContain("width: '100%'");
    expect(waitingRoom).toContain('paddingHorizontal: 22');
    expect(waitingRoom).not.toContain('paddingVertical: 14');
    // Fresh layout: a status pill, a floating mascot on a gradient stage disc,
    // a prominent gradient CTA, and a vertical stepper with gradient nodes +
    // a connector line — rendered in a ScrollView so it never clips.
    expect(waitingRoom).toContain('style={styles.statusPill}');
    expect(waitingRoom).toContain('style={styles.heroDisc}');
    expect(waitingRoom).toContain('style={styles.stepNode}');
    expect(waitingRoom).toContain('styles.stepConnector');
    expect(waitingRoom).toContain('How to pair');
    expect(waitingRoom).toContain('ScrollView');
    expect(waitingRoom).toContain('stepItems');
    expect(waitingRoom).toContain('waitingRoomUi.steps.length > 0');
    expect(waitingRoom).not.toContain('stepsCopy');
    expect(waitingRoom).not.toContain('stepRow');
    expect(waitingRoom).not.toContain('ConnectionBanner');
  });
});
