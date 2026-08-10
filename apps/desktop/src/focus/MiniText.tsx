/**
 * Stage 3: mini-text — a scrollable, markdown-rendered view of the latest
 * turn plus a composer. The body shows the full freshest message (the user
 * prompt or the streaming assistant answer), auto-scrolling to the bottom as
 * text arrives. Sending invokes the same runner turn as the main window
 * (bidirectional sync); the window itself is drag-resizable.
 *
 * Hosts the mini-text-only line primitives (header, thinking / latest /
 * idle preview lines) since nothing else consumes them.
 */

import { api, type VoiceCallPhase } from '@moxxy/client-core';
import { MarkdownBody } from '@/chat/MarkdownBody';
import { UserBlock } from '@/chat/blocks/UserBlock';
import { QueuedChip } from '@/chat/composer/QueuedChip';
import { ImagePreviewModal } from '@/chat/image-preview/ImagePreviewModal';
import type { ImagePreviewItem } from '@/chat/image-preview/types';
import { MoxxyMark } from '@/components/MoxxyMark';
import { Dot } from './focus-primitives';
import { ChevronLeftIcon, SendIcon, StopIcon, WindowIcon } from './focus-icons';
import { useLatestTurn, type LatestFocusTurn } from './useLatestTurn';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { FocusAskPrompt } from './useFocusAsk';
import { FocusAttachmentStrip } from './FocusAttachmentStrip';
import { useFocusMiniTextComposer } from './useFocusMiniTextComposer';
import { useFocusTranscriptAutoScroll } from './useFocusTranscriptAutoScroll';
import { FocusMiniVoiceStatus } from './FocusMiniVoiceStatus';

export function MiniText({
  workspaceId,
  ask,
  onBack,
  transcribing = false,
  voiceModeActive,
  voiceModePhase,
}: {
  readonly workspaceId: string | null;
  readonly ask: FocusAskPrompt | null;
  readonly onBack: () => void;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  /** True while a voice clip is being transcribed (before it's sent) — so
   *  opening the panel on mic-stop shows progress, not a stale message. */
  readonly transcribing?: boolean;
}): JSX.Element {
  const latest = useLatestTurn(workspaceId);
  const composer = useFocusMiniTextComposer({ workspaceId });
  const transcript = useFocusTranscriptAutoScroll([
    latest?.key ?? 'empty',
    composer.sending ? 'sending' : 'idle',
    transcribing ? 'transcribing' : 'ready',
  ].join(':'));

  // Show a "working" indicator while transcribing speech, or while a turn is
  // in flight but the assistant hasn't produced any text yet (otherwise the
  // user's own prompt would sit there with no sign of progress).
  const showThinking =
    transcribing || (composer.sending && (!latest || !latest.assistantLive));

  return (
    <>
      <div style={style.panel}>
        <MiniHeader
          title="Text"
          onBack={onBack}
          voiceModeActive={voiceModeActive}
          voiceModePhase={voiceModePhase}
        />
        <div
          ref={transcript.bodyRef}
          data-testid="focus-transcript"
          onScroll={transcript.onScroll}
          style={style.panelBody}
        >
          {ask && <FocusAskCard prompt={ask} variant="panel" />}
          {latest && (
            <LatestTurn
              turn={latest}
              onPreviewImage={composer.imagePreview.open}
            />
          )}
          {showThinking && (
            <ThinkingLine label={transcribing ? 'transcribing…' : 'working…'} />
          )}
          {!latest && !showThinking && (
            <IdleLine
              label={workspaceId ? 'Type a quick prompt below.' : 'No active workspace.'}
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
            <div role="status" style={style.focusAttachError}>
              {composer.attachError}
            </div>
          )}
          {composer.queued.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              aria-label={`${composer.queued.length} queued ${composer.queued.length === 1 ? 'message' : 'messages'}`}
              style={style.focusQueuedTurns}
            >
              <span aria-hidden style={style.focusQueueLabel}>Queued</span>
              {composer.queued.map((queued) => (
                <QueuedChip
                  key={queued.id}
                  text={queued.prompt}
                  onRemove={() => composer.removeQueued(queued.id)}
                />
              ))}
            </div>
          )}
          <form
            style={style.composer}
            onSubmit={(e) => {
              e.preventDefault();
              composer.submit();
            }}
          >
            <textarea
              ref={composer.inputRef}
              autoFocus
              rows={1}
              aria-label="Ask Moxxy"
              placeholder={
                workspaceId
                  ? composer.attachments.length > 0
                    ? 'Ask about the attached image…'
                    : 'Ask Moxxy…'
                  : 'No active workspace'
              }
              value={composer.draft}
              onChange={(e) => composer.setDraft(e.target.value)}
              onKeyDown={composer.onKeyDown}
              onPaste={composer.onPaste}
              disabled={!workspaceId}
              style={style.input}
            />
            {composer.canAbort && (
              <button
                type="button"
                aria-label="Stop current task"
                title="Stop current task"
                onClick={composer.abort}
                style={style.stop}
              >
                <StopIcon />
              </button>
            )}
            <button
              type="submit"
              aria-label="Send"
              disabled={!composer.canSubmit}
              style={{
                ...style.send,
                ...(composer.canSubmit ? null : style.sendDisabled),
              }}
            >
              <SendIcon />
            </button>
          </form>
        </div>
      </div>
      <ImagePreviewModal image={composer.imagePreview.image} onClose={composer.imagePreview.close} />
    </>
  );
}

// ---- Mini-text line primitives -------------------------------------------

function MiniHeader({
  title,
  onBack,
  voiceModeActive,
  voiceModePhase,
}: {
  readonly title: string;
  readonly onBack: () => void;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
}): JSX.Element {
  return (
    <header style={style.miniHeader}>
      <button type="button" onClick={onBack} style={style.headerButton} aria-label="Back">
        <ChevronLeftIcon />
      </button>
      {voiceModeActive
        ? <FocusMiniVoiceStatus phase={voiceModePhase} />
        : (
          <div style={style.miniTitle}>
            <MoxxyMark size={16} />
            <span>{title}</span>
          </div>
        )}
      <button
        type="button"
        onClick={() => void api().invoke('focus.restoreMain').catch(() => undefined)}
        style={style.headerButton}
        aria-label="Open main window"
      >
        <WindowIcon />
      </button>
    </header>
  );
}

function ThinkingLine({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={{ ...style.lineRow, marginTop: 8 }}>
      <Dot delay={0} />
      <Dot delay={160} />
      <Dot delay={320} />
      <span style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: 'var(--type-ui)' }}>{label}</span>
    </div>
  );
}

function LatestTurn({
  turn,
  onPreviewImage,
}: {
  readonly turn: LatestFocusTurn;
  readonly onPreviewImage: (image: ImagePreviewItem) => void;
}): JSX.Element {
  return (
    <section aria-label="Latest conversation" style={style.focusLatestTurn}>
      <UserBlock
        text={turn.userText}
        attachments={turn.userAttachments}
        onPreviewImage={onPreviewImage}
      />
      {turn.assistantText && (
        <div style={style.focusAssistantReply}>
          <span style={style.focusMessageLabel}>Moxxy</span>
          <MarkdownBody text={turn.assistantText} />
        </div>
      )}
    </section>
  );
}

function IdleLine({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={{ fontSize: 'var(--type-row)', color: 'var(--focus-muted)', fontStyle: 'italic' }}>{label}</div>
  );
}
