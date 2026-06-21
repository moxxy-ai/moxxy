import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildChatListContentStyle, buildOfflineEmptyStateCopy } from '../mobile/src/chatListLayout';
import { buildWaitingRoomUi, shouldShowWaitingRoom } from '../mobile/src/waitingRoomUi';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe('mobile offline gateway screen layout', () => {
  it('renders the gateway guidance inside the chat list instead of as an absolute overlay', async () => {
    const chatScreen = await readFile(join(root, 'mobile', 'app', 'chat.tsx'), 'utf8');
    const chatList = await readFile(join(root, 'mobile', 'src', 'components', 'ChatList.tsx'), 'utf8');

    expect(chatScreen).toContain('connectionBanner={connectionBanner}');
    expect(chatScreen).not.toContain('className="absolute z-10"');
    expect(chatList).toContain('readonly connectionBanner?: ReactNode');
    expect(chatList).toContain('ListHeaderComponent={header}');
  });

  it('keeps the offline guidance styled without depending on NativeWind class extraction', async () => {
    const banner = await readFile(
      join(root, 'mobile', 'src', 'components', 'ConnectionBanner.tsx'),
      'utf8',
    );

    expect(banner).toContain('StyleSheet.create');
    expect(banner).toContain('style={styles.card}');
    expect(banner).not.toContain('className=');
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
      join(root, 'mobile', 'src', 'components', 'FloatingChatHeader.tsx'),
      'utf8',
    );

    expect(header).toContain('StyleSheet.create');
    expect(header).toContain('style={styles.menuButton}');
    expect(header).toContain('style={styles.actionButton}');
    expect(header).toContain('height: 44');
    expect(header).toContain('width: 44');
  });

  it('renders a branded waiting room instead of the disabled chat composer while offline', async () => {
    const chatScreen = await readFile(join(root, 'mobile', 'app', 'chat.tsx'), 'utf8');
    const waitingRoom = await readFile(
      join(root, 'mobile', 'src', 'components', 'WaitingRoom.tsx'),
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
    expect(waitingRoom).toContain('moxxy-mascot-transparent.png');
    expect(waitingRoom).toContain('accessibilityLabel="Moxxy assistant mascot waving"');
    expect(waitingRoom).toContain('style={styles.contentStack}');
    expect(waitingRoom).toContain("alignSelf: 'center'");
    expect(waitingRoom).toContain('maxWidth: 430');
    expect(waitingRoom).toContain('</View>\n        <View style={styles.stepsCard}>');
    expect(waitingRoom).toContain('marginTop: 24');
    expect(waitingRoom).toContain('minHeight: 198');
    expect(waitingRoom).toContain("width: '100%'");
    expect(waitingRoom).toContain('paddingHorizontal: 22');
    expect(waitingRoom).toContain('paddingTop: 24');
    expect(waitingRoom).toContain('paddingBottom: 34');
    expect(waitingRoom).not.toContain('paddingVertical: 14');
    expect(waitingRoom).toContain('instructionItemSpaced');
    expect(waitingRoom).toContain('marginTop: 14');
    expect(waitingRoom).toContain('marginRight: 14');
    expect(waitingRoom).toContain('height: 30');
    expect(waitingRoom).toContain('stepItems');
    expect(waitingRoom).toContain('waitingRoomUi.steps.length > 0');
    expect(waitingRoom).not.toContain('stepsCopy');
    expect(waitingRoom).not.toContain('stepRow');
    expect(waitingRoom).not.toContain('ConnectionBanner');
  });
});
