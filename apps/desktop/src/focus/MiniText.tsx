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

import { useCallback, useEffect, useRef } from 'react';
import { api } from '@moxxy/client-core';
import { MarkdownBody } from '@/chat/MarkdownBody';
import { ImagePreviewModal } from '@/chat/image-preview/ImagePreviewModal';
import { Dot, LogoMark } from './focus-primitives';
import { ChevronLeftIcon, SendIcon, WindowIcon } from './focus-icons';
import { useLatestBlock } from './useLatestBlock';
import type { LatestBlock } from './useLatestBlock';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { FocusAskPrompt } from './useFocusAsk';
import { FocusAttachmentStrip } from './FocusAttachmentStrip';
import { useFocusMiniTextComposer } from './useFocusMiniTextComposer';

export function MiniText({
  workspaceId,
  ask,
  onBack,
  transcribing = false,
}: {
  readonly workspaceId: string | null;
  readonly ask: FocusAskPrompt | null;
  readonly onBack: () => void;
  /** True while a voice clip is being transcribed (before it's sent) — so
   *  opening the panel on mic-stop shows progress, not a stale message. */
  readonly transcribing?: boolean;
}): JSX.Element {
  const latest = useLatestBlock(workspaceId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const composer = useFocusMiniTextComposer({ workspaceId, focusInput });

  // Keep the freshest text in view as the answer streams / transcript lands.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [latest?.text, composer.sending, transcribing]);

  // Show a "working" indicator while transcribing speech, or while a turn is
  // in flight but the assistant hasn't produced any text yet (otherwise the
  // user's own prompt would sit there with no sign of progress).
  const showThinking =
    transcribing || (composer.sending && (!latest || latest.who === 'user'));

  return (
    <>
      <div style={style.panel}>
        <MiniHeader title="Text" onBack={onBack} />
        <div ref={bodyRef} style={style.panelBody}>
          {ask && <FocusAskCard prompt={ask} variant="panel" />}
          {latest && <LatestMessage block={latest} />}
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
          <form
            style={style.composer}
            onSubmit={(e) => {
              e.preventDefault();
              composer.submit();
            }}
          >
            <input
              ref={inputRef}
              autoFocus
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
              onPaste={composer.onPaste}
              disabled={!workspaceId}
              style={style.input}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!composer.canSubmit}
              style={{
                ...style.send,
                opacity: composer.canSubmit ? 1 : 0.45,
                cursor: composer.canSubmit ? 'pointer' : 'not-allowed',
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
}: {
  readonly title: string;
  readonly onBack: () => void;
}): JSX.Element {
  return (
    <header style={style.miniHeader}>
      <button type="button" onClick={onBack} style={style.headerButton} aria-label="Back">
        <ChevronLeftIcon />
      </button>
      <div style={style.miniTitle}>
        <LogoMark size={16} />
        <span>{title}</span>
      </div>
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
      <span style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: 13 }}>{label}</span>
    </div>
  );
}

/** Full latest message, markdown-rendered. A small "You" label tags the
 *  user's own turn; assistant turns render bare so they read like a reply. */
function LatestMessage({ block }: { readonly block: LatestBlock }): JSX.Element {
  return (
    <div style={{ width: '100%' }}>
      {block.who === 'user' && (
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--focus-dim)',
            marginBottom: 6,
          }}
        >
          You
        </div>
      )}
      <MarkdownBody text={block.text} />
    </div>
  );
}

function IdleLine({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--focus-muted)', fontStyle: 'italic' }}>{label}</div>
  );
}
