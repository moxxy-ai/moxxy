import { AskSheet } from '@/components/AskSheet';
import { AppShell } from '@/components/AppShell';
import { ChatList } from '@/components/ChatList';
import { CompactContextSheet } from '@/components/CompactContextSheet';
import { ComposerCard } from '@/components/ComposerCard';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { FloatingChatHeader } from '@/components/FloatingChatHeader';
import { GoalSheet } from '@/components/GoalSheet';
import { MobileMenuSheet } from '@/components/MobileMenuSheet';
import { ModelSelectorSheet } from '@/components/ModelSelectorSheet';
import { ModeSelectorSheet } from '@/components/ModeSelectorSheet';
import { RenameSessionSheet } from '@/components/RenameSessionSheet';
import { SessionActionsSheet } from '@/components/SessionActionsSheet';
import { buildFloatingSheetPlacement } from '@/floatingSheetLayout';
import { buildGoalSheetPlacement } from '@/goalSheetLayout';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useMessageCopy } from '@/hooks/useMessageCopy';
import { useMobileChrome } from '@/hooks/useMobileChrome';
import { useSessionActions } from '@/hooks/useSessionActions';
import { useWorkspaceCollapse } from '@/hooks/useWorkspaceCollapse';
import { buildMobileMenuItems, buildWorkspaceMenuSections } from '@/navigation';
import { buildChatConnectionUi } from '@/chatConnectionUi';
import { textOf } from '@/utils/record';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ChatScreen() {
  const { autoApprove, chat, compact, composer, gatewayConnected, goals, modelSelector, pairing, permissions, session, sessions, socketStatus } = useGatewayStore();
  const [composerHeight, setComposerHeight] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const chrome = useMobileChrome();
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
  const menuItems = buildMobileMenuItems(pendingActions);
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
  const handleComposerHeightChange = useCallback((height: number) => {
    setComposerHeight((current) => (Math.abs(current - height) > 1 ? height : current));
  }, []);
  const openRename = useCallback(() => {
    if (!canEditSession) return;
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

  return (
    <AppShell>
      <SafeAreaView className="relative flex-1 overflow-hidden" edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ChatList
            items={chat.items}
            sending={chat.sending}
            hasOlder={chat.hasOlder}
            onLoadOlder={chat.loadOlder}
            copiedMessageId={messageCopy.copiedMessageId}
            onCopyMessage={messageCopy.copyMessage}
          />

          {connectionUi.showConnectionBanner ? (
            <View className="absolute z-10" style={{ left: 16, position: 'absolute', right: 16, top: 76, zIndex: 10 }}>
              <ConnectionBanner paired={pairing.transportReady} connected={connectionUi.bannerConnected} status={socketStatus} />
            </View>
          ) : null}

          {pendingActions > 0 && !composer.actionsOpen && !goals.open ? (
            <View className="absolute z-40" style={floatingSheetStyle}>
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
              className="absolute z-40"
              style={{
                left: 16,
                maxHeight: goalPlacement.maxHeight,
                position: 'absolute',
                right: 16,
                top: goalPlacement.top,
                zIndex: 40,
              }}
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
            <View className="absolute z-40" style={floatingSheetStyle}>
              <CompactContextSheet
                open={compact.confirmOpen}
                compacting={chat.compacting}
                onCancel={compact.cancelCompact}
                onConfirm={compact.confirmCompact}
              />
            </View>
          ) : null}

          {modelSelector.modeOpen ? (
            <View className="absolute z-40" style={floatingSheetStyle}>
              <ModeSelectorSheet
                ui={modelSelector.modeUi}
                error={modelSelector.error}
                onClose={modelSelector.closeModePicker}
                onPickMode={modelSelector.pickMode}
              />
            </View>
          ) : null}

          {modelSelector.open ? (
            <View className="absolute z-40" style={floatingSheetStyle}>
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
            open={chrome.menuOpen}
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

          <FloatingChatHeader
            connected={session.connected}
            statusLabel={connectionUi.statusLabel}
            pendingActions={pendingActions}
            onToggleMenu={chrome.toggleMenu}
            onRenameSession={openRename}
            onOpenActions={() => {
              composer.setActionsOpen(false);
              sessionActions.openSheet();
            }}
            actionsDisabled={!session.connected}
            renameDisabled={!canEditSession}
          />

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
            onToggleActions={() => composer.setActionsOpen(!composer.actionsOpen)}
            onOpenModelSelector={() => {
              composer.setActionsOpen(false);
              modelSelector.openPicker();
            }}
            onOpenModeSelector={() => {
              composer.setActionsOpen(false);
              modelSelector.openModePicker();
            }}
            onGoal={() => goals.setOpen(true)}
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppShell>
  );
}
