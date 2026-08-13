/**
 * Stage 3: Mini Chat. It embeds the same canonical Transcript as the main
 * surface, preserving tools, skills, diffs, Markdown and streaming while the
 * compact composer drives the same runner session.
 */

import { api, type VoiceCallPhase } from '@moxxy/client-core';
import { Transcript } from '@/chat/Transcript';
import { QueuedChip } from '@/chat/composer/QueuedChip';
import { ImagePreviewModal } from '@/chat/image-preview/ImagePreviewModal';
import { MoxxyMark } from '@/components/MoxxyMark';
import { ChevronLeftIcon, SendIcon, StopIcon, WindowIcon } from './focus-icons';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { FocusAskPrompt } from './useFocusAsk';
import { FocusAttachmentStrip } from './FocusAttachmentStrip';
import { FocusMiniVoiceStatus } from './FocusMiniVoiceStatus';
import { useFocusMiniTextModel } from './useFocusMiniTextModel';

export function MiniText({
  workspaceId,
  ask,
  onBack,
  transcribing = false,
  voiceModeActive,
  voiceModePhase,
  remoteQueuedTurns,
  onRemoveRemoteQueuedTurn,
}: {
  readonly workspaceId: string | null;
  readonly ask: FocusAskPrompt | null;
  readonly onBack: () => void;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly remoteQueuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
  readonly onRemoveRemoteQueuedTurn: (id: string) => void;
  /** True while a voice clip is being transcribed (before it's sent) — so
   *  opening the panel on mic-stop shows progress, not a stale message. */
  readonly transcribing?: boolean;
}): JSX.Element {
  const { transcript, composer } = useFocusMiniTextModel({
    workspaceId,
    remoteQueuedTurns,
    onRemoveRemoteQueuedTurn,
  });
  return (
    <>
      <div style={style.panel}>
        <MiniHeader
          onBack={onBack}
          voiceModeActive={voiceModeActive}
          voiceModePhase={voiceModePhase}
        />
        <div
          data-testid="focus-transcript"
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
  onBack,
  voiceModeActive,
  voiceModePhase,
}: {
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
