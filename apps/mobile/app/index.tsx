import { sx } from '@/styles/tokens';
import { AskSheet } from '@/components/AskSheet';
import { ChatComposer } from '@/components/ChatComposer';
import { ChatDrawer } from '@/components/ChatDrawer';
import { ChatHeader } from '@/components/ChatHeader';
import { ChatList, type ChatWelcome } from '@/components/ChatList';
import { CompactContextSheet } from '@/components/CompactContextSheet';
import { ComposerSheet } from '@/components/ComposerSheet';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { ConnectionSheet } from '@/components/ConnectionSheet';
import { GoalSheet } from '@/components/GoalSheet';
import { Onboarding } from '@/components/Onboarding';
import { RenameSessionSheet } from '@/components/RenameSessionSheet';
import { buildConnectionState } from '@/connectionState';
import { useHistoryLoading } from '@/hooks/useHistoryLoading';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useMessageCopy } from '@/hooks/useMessageCopy';
import { useMobileChrome } from '@/hooks/useMobileChrome';
import { useSessionActions } from '@/hooks/useSessionActions';
import { useTheme } from '@/theme/ThemeProvider';
import { buildWorkspaceMenuSections } from '@/navigation';
import { shouldShowPendingActionsSheet } from '@/chatOverlayState';
import { textOf } from '@/utils/record';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, PanResponder, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const store = useGatewayStore();
  // No blocking gateway loader. A neutral backdrop only while the persisted
  // gateway is read from storage (sub-second); onboarding when nothing is
  // stored; otherwise the full shell — connected or not. Connection state is
  // shown inline inside the shell, never as a screen that traps the user.
  if (store.pairing.hydrating) return <Backdrop />;
  if (!store.pairing.token) return <Onboarding />;
  return <Chat />;
}

function Backdrop() {
  const { colors } = useTheme();
  return <View style={sx('flex-1', { backgroundColor: colors.appBg })} />;
}

function Chat() {
  const { colors } = useTheme();
  const {
    autoApprove,
    chat,
    compact,
    composer,
    goals,
    modelSelector,
    pairing,
    permissions,
    session,
    sessions,
  } = useGatewayStore();
  const router = useRouter();
  const [connectionSheetOpen, setConnectionSheetOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const chrome = useMobileChrome();
  const messageCopy = useMessageCopy();
  const { height: screenHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // Where the floating composer sits above the bottom edge (a touch lower than
  // the full safe-area inset so it hugs the bottom).
  const composerBottom = keyboardHeight > 0 ? keyboardHeight : Math.max(6, safeArea.bottom - 16);
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  const activeSessionRecord = sessions.sessions.find((item) => textOf(item.id) === sessions.activeWorkspaceId);
  const activeSessionTitle = textOf(activeSessionRecord?.name, textOf(session.session?.id, 'No active session'));
  const activeWorkspace = sessions.workspaces.find((w) => textOf(w.id) === textOf(activeSessionRecord?.workspaceId));
  const workspaceName = textOf(activeWorkspace?.name, textOf(activeWorkspace?.title, 'Workspace'));
  const chatTitle = textOf(activeSessionRecord?.name, textOf(activeSessionRecord?.firstPrompt, 'New chat'));
  const canEditSession = session.connected && !session.readOnly && Boolean(sessions.activeWorkspaceId);
  const activeEventCount = typeof activeSessionRecord?.eventCount === 'number' ? activeSessionRecord.eventCount : 0;
  const historyLoading = useHistoryLoading(sessions.activeWorkspaceId, chat.items.length, activeEventCount);
  const sessionActions = useSessionActions({ workspaceId: sessions.activeWorkspaceId, readOnly: session.readOnly || !session.connected, onRunCommand: composer.runCommand });
  const workspaceSections = buildWorkspaceMenuSections(sessions.workspaces, sessions.sessions, sessions.activeWorkspaceId);
  const overlayBottom = (keyboardHeight > 0 ? keyboardHeight : safeArea.bottom) + 150;
  const overlayStyle = { bottom: overlayBottom, left: 12, maxHeight: screenHeight * 0.5, position: 'absolute' as const, right: 12, zIndex: 40 };
  const showPendingActionsSheet = shouldShowPendingActionsSheet({
    pendingActions,
    composerActionsOpen: optionsOpen,
    goalsOpen: goals.open,
    compactConfirmOpen: compact.confirmOpen,
    modelPickerOpen: modelSelector.open,
    modePickerOpen: modelSelector.modeOpen,
    sessionActionsOpen: sessionActions.open,
    renameOpen,
  });

  // Open the drawer with an edge-swipe from the left, mirroring the menu button.
  const toggleMenuRef = useRef(chrome.toggleMenu);
  toggleMenuRef.current = chrome.toggleMenu;
  const edgePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && g.dx > Math.abs(g.dy) * 1.4,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 44) toggleMenuRef.current();
      },
    }),
  ).current;

  const openRename = useCallback(() => {
    if (!canEditSession) return;
    Keyboard.dismiss();
    setRenameDraft(activeSessionTitle);
    setRenameError(null);
    setRenameOpen(true);
  }, [activeSessionTitle, canEditSession]);
  const submitRename = useCallback(() => {
    const sessionId = sessions.activeWorkspaceId;
    const name = renameDraft.trim();
    if (!sessionId || !name || renameSaving) return;
    setRenameSaving(true);
    setRenameError(null);
    void sessions.renameSession(sessionId, name)
      .then(() => setRenameOpen(false))
      .catch((err) => setRenameError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRenameSaving(false));
  }, [renameDraft, renameSaving, sessions]);
  const welcome = useMemo<ChatWelcome | null>(
    () => (session.connected && !session.readOnly ? { title: 'Hey, moxxy is here', subtitle: 'Ask anything, automate a workflow, or pick up a past chat from the menu.' } : null),
    [session.connected, session.readOnly],
  );
  // Single source of truth for how the shell presents the connection. Drives the
  // header status, and (when the bridge is down) the inline banner — never a
  // full-screen loader.
  const connection = buildConnectionState({
    hasToken: Boolean(pairing.token),
    transportReady: pairing.transportReady,
    sessionConnected: session.connected,
    readOnly: session.readOnly,
    error: pairing.error,
  });

  return (
    <View style={sx('flex-1', { backgroundColor: colors.appBg })}>
      <SafeAreaView style={sx('flex-1')} edges={['top']}>
        <ChatHeader
          title={chatTitle}
          subtitle={connection.online ? workspaceName : connection.headerLabel}
          connected={connection.online}
          pendingActions={pendingActions}
          onMenu={() => { Keyboard.dismiss(); chrome.toggleMenu(); }}
          onRename={openRename}
          renameDisabled={!canEditSession}
          onStatusPress={() => { Keyboard.dismiss(); setConnectionSheetOpen(true); }}
        />

        <ChatList
          items={chat.items}
          sending={chat.sending}
          hasOlder={chat.hasOlder}
          welcome={welcome}
          loading={historyLoading}
          bottomInset={composerBottom + 72 + (composer.attachments.length > 0 ? 66 : 0)}
          connectionBanner={connection.showBanner ? (
            <ConnectionBanner
              banner={connection.banner}
              onReconnect={pairing.reconnect}
              onOpenSettings={() => setConnectionSheetOpen(true)}
            />
          ) : undefined}
          onLoadOlder={chat.loadOlder}
          copiedMessageId={messageCopy.copiedMessageId}
          onCopyMessage={messageCopy.copyMessage}
        />

        {showPendingActionsSheet ? (
          <View style={overlayStyle}>
            <AskSheet asks={permissions.pendingAsks} permissions={permissions.pendingPermissions} maxHeight={screenHeight * 0.5} onAskResponse={permissions.respondAsk} onPermissionDecision={permissions.decidePermission} />
          </View>
        ) : null}
        {/* Composer floats over the transcript so content scrolls under the
            glass (true glassmorphism), not cut off behind a solid bar. */}
        <View
          pointerEvents="box-none"
          style={{ bottom: composerBottom, left: 0, position: 'absolute', right: 0 }}
        >
          <ChatComposer
            text={composer.text}
            inputResetKey={composer.inputResetKey}
            sending={chat.sending}
            compacting={chat.compacting}
            autoApprove={autoApprove.enabled}
            readOnly={session.readOnly}
            voicePhase={composer.voicePhase}
            voiceError={composer.voiceError}
            attachments={composer.attachments}
            attachmentError={composer.attachmentError}
            accentBorder={autoApprove.enabled ? colors.primary : modelSelector.modeUi.modeRows.find((m) => m.active)?.id === 'goal' ? colors.amber : undefined}
            onRemoveAttachment={composer.removeAttachment}
            onTextChange={composer.setText}
            onSubmit={composer.submit}
            onAbort={composer.abort}
            onVoice={composer.transcribe}
            onOpenOptions={() => { Keyboard.dismiss(); setOptionsOpen(true); }}
          />
        </View>

        {/* Left edge-swipe to open the drawer. */}
        <View {...edgePan.panHandlers} style={{ bottom: 0, left: 0, position: 'absolute', top: 0, width: 24, zIndex: 20 }} />
      </SafeAreaView>

      <ConnectionSheet
        open={connectionSheetOpen}
        onClose={() => setConnectionSheetOpen(false)}
        state={connection}
        pairing={pairing}
        onOpenSettings={() => router.push('/account')}
      />
      <RenameSessionSheet open={renameOpen} value={renameDraft} error={renameError} saving={renameSaving} onChange={setRenameDraft} onCancel={() => setRenameOpen(false)} onSubmit={submitRename} />
      <CompactContextSheet open={compact.confirmOpen} compacting={chat.compacting} onCancel={compact.cancelCompact} onConfirm={compact.confirmCompact} />
      <GoalSheet open={goals.open} objective={goals.objective} canStart={goals.canStart} onObjectiveChange={goals.setObjective} onStart={goals.startGoal} onClose={() => goals.setOpen(false)} />

      <ComposerSheet
        open={optionsOpen}
        autoApprove={autoApprove.enabled}
        modelUi={modelSelector.ui}
        modeUi={modelSelector.modeUi}
        readOnly={session.readOnly}
        onClose={() => setOptionsOpen(false)}
        onPickImage={composer.pickImageAttachment}
        onPickFile={composer.pickDocumentAttachment}
        onSelectProvider={modelSelector.selectProvider}
        onPickModel={modelSelector.pickModel}
        onPickMode={modelSelector.pickMode}
        actions={{
          rows: sessionActions.actions,
          allCount: sessionActions.allActionsCount,
          filter: sessionActions.filter,
          error: sessionActions.error,
          argsFor: sessionActions.argsFor,
          argValues: sessionActions.argValues,
          readOnly: session.readOnly || !session.connected,
          onFilterChange: sessionActions.setFilter,
          onSelect: sessionActions.selectAction,
          onArgChange: sessionActions.setArgValue,
          onRunArgs: sessionActions.runArgsAction,
          onBack: sessionActions.backToList,
          load: sessionActions.openSheet,
          reset: sessionActions.close,
        }}
        onGoal={() => goals.setOpen(true)}
        onToggleAutoApprove={() => autoApprove.setAutoApprove(!autoApprove.enabled)}
        onCompact={compact.requestCompact}
        onNewSession={() => sessions.newSession()}
      />

      <ChatDrawer
        open={chrome.menuOpen}
        connected={session.connected}
        workspaceSections={workspaceSections}
        onSelectSession={sessions.selectWorkspace}
        onNewSession={sessions.newSession}
        onClose={chrome.closeMenu}
        onRenameSession={sessions.renameSession}
        onRemoveSession={sessions.removeSession}
        onRenameWorkspace={sessions.renameWorkspace}
        onRemoveWorkspace={sessions.removeWorkspace}
      />
    </View>
  );
}
