import { sx } from '../src/styles/tokens';
import { AskSheet } from '@/components/AskSheet';
import { AppShell } from '@/components/AppShell';
import { ChatList } from '@/components/ChatList';
import { CompactContextSheet } from '@/components/CompactContextSheet';
import { ComposerCard } from '@/components/ComposerCard';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { ChatFloatingControls } from '@/components/ChatFloatingControls';
import { GoalSheet } from '@/components/GoalSheet';
import { MobileMenuSheet } from '@/components/MobileMenuSheet';
import { ModelSelectorSheet } from '@/components/ModelSelectorSheet';
import { ModeSelectorSheet } from '@/components/ModeSelectorSheet';
import { RenameSessionSheet } from '@/components/RenameSessionSheet';
import { SessionActionsSheet } from '@/components/SessionActionsSheet';
import { WaitingRoom } from '@/components/WaitingRoom';
import { buildFloatingSheetPlacement } from '@/floatingSheetLayout';
import { buildGoalSheetPlacement } from '@/goalSheetLayout';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useMessageCopy } from '@/hooks/useMessageCopy';
import { useMobileChrome } from '@/hooks/useMobileChrome';
import { useSessionActions } from '@/hooks/useSessionActions';
import { useWorkspaceCollapse } from '@/hooks/useWorkspaceCollapse';
import { openWaitingRoomPairing } from '@/pairingFlow';
import { buildMobileMenuItems, buildWorkspaceMenuSections } from '@/navigation';
import { buildChatConnectionUi } from '@/chatConnectionUi';
import { shouldShowPendingActionsSheet } from '@/chatOverlayState';
import { textOf } from '@/utils/record';
import { buildWaitingRoomUi, shouldShowWaitingRoom } from '@/waitingRoomUi';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ChatScreen() {
  const {
    autoApprove,
    chat,
    compact,
    composer,
    gatewayConnected,
    goals,
    modelSelector,
    pairing,
    permissions,
    session,
    sessionLoading,
    sessions,
    socketStatus,
  } = useGatewayStore();
  const [composerHeight, setComposerHeight] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const chrome = useMobileChrome();
  const router = useRouter();
  const messageCopy = useMessageCopy();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  const connectionUi = buildChatConnectionUi({
    gatewayConnected,
    selectedSessionConnected: session.connected,
    selectedSessionReadOnly: session.readOnly,
    sending: chat.sending,
  });
  const sessionLabel = textOf(session.session?.id, 'No active session');
  const activeSessionRecord = sessions.sessions.find((item) => textOf(item.id) === sessions.activeWorkspaceId);
  const activeSessionTitle = textOf(activeSessionRecord?.name, sessionLabel);
  const canEditSession = session.connected && !session.readOnly && Boolean(sessions.activeWorkspaceId);
  const sessionActions = useSessionActions({
    workspaceId: sessions.activeWorkspaceId,
    readOnly: session.readOnly || !session.connected,
    onRunCommand: composer.runCommand,
  });
  const menuItems = buildMobileMenuItems(pendingActions, { sessionLoading });
  const workspaceSections = buildWorkspaceMenuSections(sessions.workspaces, sessions.sessions, sessions.activeWorkspaceId);
  const workspaceCollapse = useWorkspaceCollapse(workspaceSections);
  const { height: screenHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const goalPlacement = buildGoalSheetPlacement({
    screenHeight,
    topSafeArea: safeArea.top,
    keyboardHeight,
  });
  const floatingSheet = buildFloatingSheetPlacement({
    composerHeight,
    screenHeight,
    topSafeArea: safeArea.top,
  });
  const floatingSheetStyle = {
    bottom: floatingSheet.bottom,
    left: 16,
    maxHeight: floatingSheet.maxHeight,
    position: 'absolute' as const,
    right: 16,
    zIndex: 40,
  };
  const showPendingActionsSheet = shouldShowPendingActionsSheet({
    pendingActions,
    composerActionsOpen: composer.actionsOpen,
    goalsOpen: goals.open,
    compactConfirmOpen: compact.confirmOpen,
    modelPickerOpen: modelSelector.open,
    modePickerOpen: modelSelector.modeOpen,
    sessionActionsOpen: sessionActions.open,
    renameOpen,
  });
  const handleComposerHeightChange = useCallback((height: number) => {
    setComposerHeight((current) => (Math.abs(current - height) > 1 ? height : current));
  }, []);
  const openRename = useCallback(() => {
    if (!canEditSession) return;
    Keyboard.dismiss();
    composer.setActionsOpen(false);
    setRenameDraft(activeSessionTitle);
    setRenameError(null);
    setRenameOpen(true);
  }, [activeSessionTitle, canEditSession, composer]);
  const closeRename = useCallback(() => {
    setRenameOpen(false);
    setRenameError(null);
  }, []);
  const submitRename = useCallback(() => {
    const sessionId = sessions.activeWorkspaceId;
    const name = renameDraft.trim();
    if (!sessionId || !name || renameSaving) return;
    setRenameSaving(true);
    setRenameError(null);
    void sessions.renameSession(sessionId, name)
      .then(() => {
        setRenameOpen(false);
      })
      .catch((err) => {
        setRenameError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setRenameSaving(false);
      });
  }, [renameDraft, renameSaving, sessions]);
  const showWaitingRoom = shouldShowWaitingRoom(connectionUi.showConnectionBanner);
  const waitingRoomUi = buildWaitingRoomUi({ paired: pairing.transportReady, status: socketStatus });
  const connectionBanner = !showWaitingRoom && connectionUi.showConnectionBanner ? (
    <ConnectionBanner paired={pairing.transportReady} connected={connectionUi.bannerConnected} status={socketStatus} />
  ) : null;
  const openPairing = useCallback(() => {
    openWaitingRoomPairing({
      closeMenu: chrome.closeMenu,
      dismissKeyboard: Keyboard.dismiss,
      navigateToScanner: router.push,
    });
  }, [chrome.closeMenu, router]);

  useEffect(() => {
    if (showWaitingRoom) chrome.closeMenu();
  }, [chrome.closeMenu, showWaitingRoom]);

  return (
    <AppShell>
      <SafeAreaView style={sx('relative flex-1 overflow-hidden')} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={sx('flex-1')}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {showWaitingRoom ? (
            <WaitingRoom
              waitingRoomUi={waitingRoomUi}
              onOpenPairing={openPairing}
            />
          ) : (
            <ChatList
              items={chat.items}
              connectionBanner={connectionBanner}
              sending={chat.sending}
              hasOlder={chat.hasOlder}
              onLoadOlder={chat.loadOlder}
              copiedMessageId={messageCopy.copiedMessageId}
              onCopyMessage={messageCopy.copyMessage}
            />
          )}

          {showPendingActionsSheet ? (
            <View style={sx('absolute z-40', floatingSheetStyle)}>
              <AskSheet
                asks={permissions.pendingAsks}
                permissions={permissions.pendingPermissions}
                maxHeight={floatingSheet.maxHeight}
                onAskResponse={permissions.respondAsk}
                onPermissionDecision={permissions.decidePermission}
              />
            </View>
          ) : null}

          {goals.open ? (
            <View
              style={sx('absolute z-40', {
                left: 16,
                maxHeight: goalPlacement.maxHeight,
                position: 'absolute',
                right: 16,
                top: goalPlacement.top,
                zIndex: 40,
              })}
            >
              <GoalSheet
                objective={goals.objective}
                canStart={goals.canStart}
                maxHeight={goalPlacement.maxHeight}
                inputMaxHeight={goalPlacement.inputMaxHeight}
                onObjectiveChange={goals.setObjective}
                onStart={goals.startGoal}
                onClose={() => goals.setOpen(false)}
              />
            </View>
          ) : null}

          {compact.confirmOpen ? (
            <View style={sx('absolute z-40', floatingSheetStyle)}>
              <CompactContextSheet
                open={compact.confirmOpen}
                compacting={chat.compacting}
                onCancel={compact.cancelCompact}
                onConfirm={compact.confirmCompact}
              />
            </View>
          ) : null}

          {modelSelector.modeOpen ? (
            <View style={sx('absolute z-40', floatingSheetStyle)}>
              <ModeSelectorSheet
                ui={modelSelector.modeUi}
                error={modelSelector.error}
                onClose={modelSelector.closeModePicker}
                onPickMode={modelSelector.pickMode}
              />
            </View>
          ) : null}

          {modelSelector.open ? (
            <View style={sx('absolute z-40', floatingSheetStyle)}>
              <ModelSelectorSheet
                ui={modelSelector.ui}
                error={modelSelector.error}
                onClose={modelSelector.closePicker}
                onSelectProvider={modelSelector.selectProvider}
                onPickModel={modelSelector.pickModel}
              />
            </View>
          ) : null}

          <MobileMenuSheet
            open={showWaitingRoom ? false : chrome.menuOpen}
            items={menuItems}
            connected={session.connected}
            sessionLabel={sessionLabel}
            modeLabel={session.activeMode ?? 'Mode'}
            providerLabel={session.activeProvider ?? 'Provider'}
            autoApprove={autoApprove.enabled}
            workspaceSections={workspaceSections}
            collapsedWorkspaceIds={workspaceCollapse.collapsedWorkspaceIds}
            onSelectSession={sessions.selectWorkspace}
            onNewSession={sessions.newSession}
            onCommand={composer.runCommand}
            onToggleWorkspace={workspaceCollapse.toggleWorkspace}
            onClose={chrome.closeMenu}
          />

          {!showWaitingRoom ? (
            <ChatFloatingControls
              pendingActions={pendingActions}
              onToggleMenu={() => {
                Keyboard.dismiss();
                chrome.toggleMenu();
              }}
              onRenameSession={openRename}
              onOpenActions={() => {
                Keyboard.dismiss();
                composer.setActionsOpen(false);
                sessionActions.openSheet();
              }}
              actionsDisabled={!session.connected}
              renameDisabled={!canEditSession}
            />
          ) : null}

          <SessionActionsSheet
            open={sessionActions.open}
            actions={sessionActions.actions}
            allActionsCount={sessionActions.allActionsCount}
            filter={sessionActions.filter}
            error={sessionActions.error}
            readOnly={session.readOnly || !session.connected}
            argsFor={sessionActions.argsFor}
            argValues={sessionActions.argValues}
            onFilterChange={sessionActions.setFilter}
            onSelectAction={sessionActions.selectAction}
            onArgValueChange={sessionActions.setArgValue}
            onRunArgsAction={sessionActions.runArgsAction}
            onBackToList={sessionActions.backToList}
            onClose={sessionActions.close}
          />

          <RenameSessionSheet
            open={renameOpen}
            value={renameDraft}
            error={renameError}
            saving={renameSaving}
            onChange={setRenameDraft}
            onCancel={closeRename}
            onSubmit={submitRename}
          />

          {!showWaitingRoom ? (
            <ComposerCard
              text={composer.text}
              inputResetKey={composer.inputResetKey}
              sending={chat.sending}
              compacting={chat.compacting}
              autoApprove={autoApprove.enabled}
              actionsOpen={composer.actionsOpen}
              voicePhase={composer.voicePhase}
              voiceError={composer.voiceError}
              attachments={composer.attachments}
              attachmentError={composer.attachmentError}
              readOnly={session.readOnly}
              usage={chat.usage}
              modelLabel={modelSelector.ui.chipLabel}
              modelDisabled={modelSelector.disabled}
              modeLabel={modelSelector.modeUi.chipLabel}
              modeDisabled={modelSelector.modeUi.disabled || !session.connected || session.readOnly}
              modeBanner={modelSelector.modeUi.banner}
              onTextChange={composer.setText}
              onSubmit={composer.submit}
              onAbort={composer.abort}
              onToggleActions={() => {
                if (!composer.actionsOpen) Keyboard.dismiss();
                composer.setActionsOpen(!composer.actionsOpen);
              }}
              onOpenModelSelector={() => {
                Keyboard.dismiss();
                composer.setActionsOpen(false);
                modelSelector.openPicker();
              }}
              onOpenModeSelector={() => {
                Keyboard.dismiss();
                composer.setActionsOpen(false);
                modelSelector.openModePicker();
              }}
              onGoal={() => {
                Keyboard.dismiss();
                goals.setOpen(true);
              }}
              onVoice={composer.transcribe}
              onPickImage={composer.pickImageAttachment}
              onPickFile={composer.pickDocumentAttachment}
              onRemoveAttachment={composer.removeAttachment}
              onToggleAutoApprove={() => autoApprove.setAutoApprove(!autoApprove.enabled)}
              onNewSession={sessions.newSession}
              onCompact={compact.requestCompact}
              onCommand={composer.runCommand}
              onHeightChange={handleComposerHeightChange}
            />
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppShell>
  );
}
