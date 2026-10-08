/**
 * Stage 3: Mini Chat. It embeds the same canonical Transcript as the main
 * surface, preserving tools, skills, diffs, Markdown and streaming while the
 * compact composer drives the same runner session.
 */

import { api, type VoiceCallPhase } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { Transcript } from '@/chat/Transcript';
import { ComposerStatus } from '@/chat/composer/ComposerStatus';
import { QueuedChip } from '@/chat/composer/QueuedChip';
import { SendButton } from '@/chat/composer/SendButton';
import { SlashMenu } from '@/chat/composer/slash/SlashMenu';
import { ImagePreviewModal } from '@/chat/image-preview/ImagePreviewModal';
import { MoxxyMark } from '@/components/MoxxyMark';
import { ChevronLeftIcon, WindowIcon } from './focus-icons';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { FocusAskPrompt } from './useFocusAsk';
import { FocusAttachmentStrip } from './FocusAttachmentStrip';
import { ComposerAlert } from '@/chat/composer/ComposerAlert';
import { DropVeil } from '@/chat/DropVeil';
import { useFileDropZone } from '@/chat/useFileDropZone';
import { FocusMiniVoiceStatus } from './FocusMiniVoiceStatus';
import { useFocusMiniTextModel } from './useFocusMiniTextModel';

export function MiniText({
  workspaceId,
  ask,
  onBack,
  transcribing = false,
  voiceModeAvailable,
  voiceModeActive,
  voiceModePhase,
  onStartVoiceMode,
  onEndVoiceMode,
  remoteQueuedTurns,
  onRemoveRemoteQueuedTurn,
}: {
  readonly workspaceId: string | null;
  readonly ask: FocusAskPrompt | null;
  readonly onBack: () => void;
  /** A voice conversation can be held with this chat, or one is open. */
  readonly voiceModeAvailable: boolean;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly onStartVoiceMode: () => void;
  readonly onEndVoiceMode: () => void;
  readonly remoteQueuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
  readonly onRemoveRemoteQueuedTurn: (id: string) => void;
  /** True while a voice clip is being transcribed (before it's sent) — so
   *  opening the panel on mic-stop shows progress, not a stale message. */
  readonly transcribing?: boolean;
}): JSX.Element {
  // Files dropped anywhere on the panel go to the composer, which stages them.
  const drop = useFileDropZone();
  const { transcript, composer } = useFocusMiniTextModel({
    workspaceId,
    remoteQueuedTurns,
    onRemoveRemoteQueuedTurn,
  });
  return (
    <>
      <div data-testid="focus-mini-chat" style={style.panel} {...drop.zone}>
        {drop.over && <DropVeil />}
        <MiniHeader
          onBack={onBack}
          voiceModeAvailable={voiceModeAvailable}
          voiceModeActive={voiceModeActive}
          voiceModePhase={voiceModePhase}
          onToggleVoiceMode={voiceModeActive ? onEndVoiceMode : onStartVoiceMode}
        />
        <div
          data-testid="focus-transcript"
          className="focus-transcript"
          style={style.panelBody}
        >
          {ask && <FocusAskCard prompt={ask} variant="panel" />}
          {transcribing && <TransientStatus label="Transcribing…" />}
          {!workspaceId || (transcript.isEmpty && !transcript.sending) ? (
            <IdleLine
              label={workspaceId ? 'Type a quick prompt below.' : 'No active workspace.'}
            />
          ) : (
            <Transcript
              events={transcript.events}
              extensions={transcript.extensions}
              streamingText={transcript.streamingText}
              streamingReasoning={transcript.streamingReasoning}
              sending={transcript.sending}
              workspaceId={workspaceId ?? undefined}
              hasOlder={transcript.hasOlder}
              onReachedTop={transcript.loadOlder}
              onPreviewImage={composer.imagePreview.open}
              compactTools={transcript.compactTools}
              onPlanNext={transcript.planNext}
            />
          )}
        </div>
        <div style={style.composerDock}>
          <FocusAttachmentStrip
            attachments={composer.attachments}
            previews={composer.attachmentPreviews}
            onPreview={composer.imagePreview.open}
            onRemove={composer.removeAttachment}
          />
          {composer.attachError && (
            <ComposerAlert text={composer.attachError} onDismiss={composer.dismissAttachError} />
          )}
          {/* The desktop composer's own card, field, slash menu and send button,
              so the two never drift; only the add menu and dictation are left out. */}
          <form
            className="cmdbar__card"
            onSubmit={(e) => {
              e.preventDefault();
              composer.submit();
            }}
          >
            <ComposerStatus
              mode={composer.session.mode}
              modeBusy={composer.running}
              onLeaveMode={composer.session.leaveMode}
              autoApprove={composer.session.autoApprove}
              goalArmed={composer.goalArmed}
              onStandDownGoal={composer.standDownGoal}
            />
            {composer.queued.length > 0 && (
              <div
                role="status"
                aria-live="polite"
                aria-label={`${composer.queued.length} queued ${composer.queued.length === 1 ? 'message' : 'messages'}`}
                className="cmdbar__pending"
              >
                {composer.queued.map((queued) => (
                  <QueuedChip
                    key={queued.key}
                    text={queued.prompt}
                    onRemove={queued.onRemove}
                    compact
                  />
                ))}
              </div>
            )}
            <div className="cmdbar__in">
              {composer.slash.open && (
                <SlashMenu
                  options={composer.slash.options}
                  active={composer.slash.active}
                  onPick={composer.slash.pick}
                />
              )}
              <textarea
                ref={composer.inputRef}
                className="cmdbar__ta"
                autoFocus
                rows={1}
                aria-label="Message Moxxy"
                placeholder={composer.placeholder}
                value={composer.draft}
                onChange={(e) => composer.setDraft(e.target.value)}
                onKeyDown={composer.onKeyDown}
                onPaste={composer.onPaste}
                disabled={!workspaceId}
              />
              <div className="cmdbar__acts">
                <SendButton
                  running={composer.running}
                  action={composer.sendAction}
                  disabled={!composer.canSubmit}
                  onStop={composer.abort}
                />
              </div>
            </div>
          </form>
        </div>
      </div>
      <ImagePreviewModal image={composer.imagePreview.image} onClose={composer.imagePreview.close} />
    </>
  );
}

// ---- Mini-text line primitives -------------------------------------------

/**
 * The desktop header in small: where you came from on the left, what the window
 * can do on the right, and the brand (or the conversation's state) between them.
 */
function MiniHeader({
  onBack,
  voiceModeAvailable,
  voiceModeActive,
  voiceModePhase,
  onToggleVoiceMode,
}: {
  readonly onBack: () => void;
  readonly voiceModeAvailable: boolean;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly onToggleVoiceMode: () => void;
}): JSX.Element {
  return (
    <header style={style.miniHeader}>
      <div style={style.miniHeaderStart}>
        <button
          type="button"
          onClick={onBack}
          className="composer-btn tip"
          style={style.headerButton}
          aria-label="Back"
          data-tip="Back"
          data-tip-side="bottom"
        >
          <ChevronLeftIcon />
        </button>
      </div>
      {voiceModeActive
        ? <FocusMiniVoiceStatus phase={voiceModePhase} />
        : (
          <div style={style.miniTitle}>
            <MoxxyMark size={16} />
          </div>
        )}
      <div style={style.miniHeaderEnd}>
        {voiceModeAvailable && (
          <button
            type="button"
            onClick={onToggleVoiceMode}
            className="composer-btn tip"
            style={style.headerButton}
            aria-label={voiceModeActive ? 'End voice conversation' : 'Start voice conversation'}
            aria-pressed={voiceModeActive}
            data-tone={voiceModeActive ? 'live' : undefined}
            data-tip={voiceModeActive ? 'End voice conversation' : 'Voice conversation'}
            data-tip-side="bottom"
          >
            <Icon name={voiceModeActive ? 'phone-down' : 'phone'} size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void api().invoke('focus.restoreMain').catch(() => undefined)}
          className="composer-btn tip"
          style={style.headerButton}
          aria-label="Open main window"
          data-tip="Open main window"
          data-tip-side="bottom"
        >
          <WindowIcon />
        </button>
      </div>
    </header>
  );
}

function TransientStatus({ label }: { readonly label: string }): JSX.Element {
  return (
    <div role="status" style={style.focusTransientStatus}>
      {label}
    </div>
  );
}

function IdleLine({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={{ fontSize: 'var(--type-row)', color: 'var(--focus-muted)', fontStyle: 'italic' }}>{label}</div>
  );
}
