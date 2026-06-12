import { AskSheet } from '@/components/AskSheet';
import { AppShell } from '@/components/AppShell';
import { ChatList } from '@/components/ChatList';
import { CompactContextSheet } from '@/components/CompactContextSheet';
import { ComposerCard } from '@/components/ComposerCard';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { FloatingChatHeader } from '@/components/FloatingChatHeader';
import { GoalSheet } from '@/components/GoalSheet';
import { MobileMenuSheet } from '@/components/MobileMenuSheet';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useMessageCopy } from '@/hooks/useMessageCopy';
import { useMobileChrome } from '@/hooks/useMobileChrome';
import { useWorkspaceCollapse } from '@/hooks/useWorkspaceCollapse';
import { buildMobileMenuItems, buildWorkspaceMenuSections } from '@/navigation';
import { textOf } from '@/utils/record';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ChatScreen() {
  const { autoApprove, chat, compact, composer, goals, pairing, permissions, session, sessions, socketStatus } = useGatewayStore();
  const chrome = useMobileChrome();
  const messageCopy = useMessageCopy();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  const statusLabel = chat.sending ? 'Thinking' : session.connected ? 'Connected' : 'Offline';
  const sessionLabel = textOf(session.session?.id, 'No active session');
  const menuItems = buildMobileMenuItems(pendingActions);
  const workspaceSections = buildWorkspaceMenuSections(sessions.workspaces, sessions.sessions, sessions.activeWorkspaceId);
  const workspaceCollapse = useWorkspaceCollapse(workspaceSections);

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
            copiedMessageId={messageCopy.copiedMessageId}
            onCopyMessage={messageCopy.copyMessage}
          />

          {!session.connected ? (
            <View className="absolute z-10" style={{ left: 16, position: 'absolute', right: 16, top: 76, zIndex: 10 }}>
              <ConnectionBanner paired={pairing.transportReady} connected={session.connected} status={socketStatus} />
            </View>
          ) : null}

          {pendingActions > 0 && !composer.actionsOpen && !goals.open ? (
            <View className="absolute z-20" style={{ bottom: 126, left: 16, position: 'absolute', right: 16, zIndex: 20 }}>
              <AskSheet
                asks={permissions.pendingAsks}
                permissions={permissions.pendingPermissions}
                onAskResponse={permissions.respondAsk}
                onPermissionDecision={permissions.decidePermission}
              />
            </View>
          ) : null}

          {goals.open ? (
            <View className="absolute z-40" style={{ bottom: 126, left: 16, position: 'absolute', right: 16, zIndex: 40 }}>
              <GoalSheet
                objective={goals.objective}
                canStart={goals.canStart}
                onObjectiveChange={goals.setObjective}
                onStart={goals.startGoal}
                onClose={() => goals.setOpen(false)}
              />
            </View>
          ) : null}

          {compact.confirmOpen ? (
            <View className="absolute z-40" style={{ bottom: 126, left: 16, position: 'absolute', right: 16, zIndex: 40 }}>
              <CompactContextSheet
                open={compact.confirmOpen}
                compacting={chat.compacting}
                onCancel={compact.cancelCompact}
                onConfirm={compact.confirmCompact}
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
            statusLabel={statusLabel}
            pendingActions={pendingActions}
            onToggleMenu={chrome.toggleMenu}
            onNewSession={sessions.newSession}
            onToggleActions={() => composer.setActionsOpen(!composer.actionsOpen)}
          />

          <ComposerCard
            text={composer.text}
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
            onTextChange={composer.setText}
            onSubmit={composer.submit}
            onAbort={composer.abort}
            onToggleActions={() => composer.setActionsOpen(!composer.actionsOpen)}
            onGoal={() => goals.setOpen(true)}
            onVoice={composer.transcribe}
            onPickImage={composer.pickImageAttachment}
            onPickFile={composer.pickDocumentAttachment}
            onRemoveAttachment={composer.removeAttachment}
            onToggleAutoApprove={() => autoApprove.setAutoApprove(!autoApprove.enabled)}
            onNewSession={sessions.newSession}
            onCompact={compact.requestCompact}
            onCommand={composer.runCommand}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppShell>
  );
}
