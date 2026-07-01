import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { api } from '@moxxy/client-core';
import { useQueuedTurns } from '@moxxy/client-core';
import { useVoiceRecorder } from '@moxxy/client-core';
import { useActiveModeBadge } from '@moxxy/client-core';
import { chatStore } from '@moxxy/client-core';
import { composerDraftStore, usePendingComposerDraft } from '@moxxy/client-core';
import { useAgentSession } from './agent-picker/useAgentSession';
import { ModeBanner } from './composer/ModeBanner';
import { ModelContextControl } from './composer/ModelContextControl';
import { CommandPalette } from './CommandPalette';
import { ToolChip } from './composer/ToolChip';
import { OverflowMenu, type OverflowMenuItem } from './composer/OverflowMenu';
import { GoalModal } from './composer/GoalModal';
import { QueuedChip } from './composer/QueuedChip';
import { AttachmentChip } from './composer/AttachmentChip';
import { sendBtn } from './composer/composer-styles';
import {
  useComposerAttachments,
  type ComposerAttachment,
} from './composer/useComposerAttachments';
import { useComposerSubmit } from './composer/useComposerSubmit';
import { useAttachmentImagePreviews } from './image-preview/useAttachmentImagePreviews';
import type { ImagePreviewItem } from './image-preview/types';

/** Past this height the composer textarea stops growing and scrolls
 *  internally (≈ 8 lines at the composer's font/line metrics). */
const MAX_TEXTAREA_HEIGHT = 190;

interface ComposerProps {
  readonly ready: boolean;
  readonly sending: boolean;
  /** Runner is compacting the context — lock the composer entirely. */
  readonly compacting: boolean;
  readonly activeTurnId: string | null;
  readonly workspaceId: string;
  readonly onSend: (
    prompt: string,
    attachments?: ReadonlyArray<ComposerAttachment>,
  ) => void;
  readonly onAbort: () => void;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}

/**
 * Composer rendered as a rounded white card flush against the chat
 * pane bottom.
 *
 *   Enter         submit
 *   Shift+Enter   newline
 *   ⌘↵ / Ctrl+↵   submit (kept for terminal muscle memory)
 *   Esc           clear draft
 *
 * Tooling chips: Attach (file picker → appends a file: reference to
 * the draft) and Voice (push-to-record with MediaRecorder, transcribed
 * via the runner's active transcriber — disabled if none is set).
 *
 * Pasting an image (e.g. a screenshot) attaches it: the bytes are
 * persisted to a temp file by the main process and added as a regular
 * attachment chip. The textarea also auto-grows to fit the draft.
 */
export function Composer({
  ready,
  sending,
  compacting,
  activeTurnId,
  workspaceId,
  onSend,
  onAbort,
  onPreviewImage,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [hasTranscriber, setHasTranscriber] = useState(false);
  const [noTranscriberMsg, setNoTranscriberMsg] = useState<string | null>(null);
  const voice = useVoiceRecorder({
    onTranscript: (t) => setDraft((d) => (d ? `${d.trimEnd()} ${t}` : t)),
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // The "no transcriber" toast auto-clears after a delay; track the timer so
  // repeated voice clicks don't stack timers and so it can't fire setState
  // after the composer unmounts (workspace switch).
  const noTranscriberTimer = useRef<number | undefined>(undefined);

  /** Stable callback for the attachment hooks to refocus the textarea. */
  const focusInput = useCallback(() => taRef.current?.focus(), []);

  // Attachment handling (rail file-insert, native picker, image paste) lives
  // in its own hook so the attach path is independently testable.
  const {
    attachments,
    removeAttachment,
    clearAttachments,
    attachError,
    onAttach,
    onPaste,
  } = useComposerAttachments(focusInput);
  const attachmentPreviews = useAttachmentImagePreviews(workspaceId, attachments);

  const setDraftEmpty = useCallback(() => setDraft(''), []);
  const closeGoal = useCallback(() => setGoalOpen(false), []);

  const inFlight = activeTurnId !== null || sending;
  // The user can type / submit even while a turn is running — the
  // send() call queues it; the drainer ships it the moment the
  // current turn completes. A compaction is the one exception: the
  // composer locks fully until the runner finishes summarizing.
  const canSubmit =
    ready && !compacting && (draft.trim().length > 0 || attachments.length > 0);
  const queued = useQueuedTurns(workspaceId);
  // Auto-approve ("yolo") for this workspace — mirrored to the runner-side
  // driver so tool calls skip the approval sheet. Goal mode turns it on.
  const autoApprove = useSyncExternalStore(chatStore.subscribe, () =>
    chatStore.getAutoApprove(workspaceId),
  );
  // Presentation badge of the active mode (goal mode advertises one). When
  // set, the composer wears a persistent accent banner so the user always
  // knows an autonomous mode is driving the session.
  const modeBadge = useActiveModeBadge(workspaceId);

  // Session info + provider/model/mode mutations. One fetch feeds both the Mode
  // submenu in the "+" overflow and the model/context control on the right.
  const agent = useAgentSession(workspaceId, !ready || inFlight);

  // Send orchestration (submit / auto-approve / one-click goal) lives in its
  // own hook; the composer still owns the draft + attachment state.
  const { submit, setAutoApprove, startGoal } = useComposerSubmit({
    ready,
    canSubmit,
    draft,
    attachments,
    workspaceId,
    onSend,
    clearDraft: setDraftEmpty,
    clearAttachments,
    closeGoal,
  });

  // Probe transcriber availability when the connection comes up.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void api()
      .invoke('session.hasTranscriber')
      .then((has) => {
        if (!cancelled) setHasTranscriber(has);
      })
      .catch(() => {
        if (!cancelled) setHasTranscriber(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // The auto-approve flag lives on the per-workspace driver, which is
  // recreated when the runner reconnects (resetting to off). Re-apply our
  // known state whenever the connection comes (back) up so a reconnect
  // mid-goal-run doesn't silently start prompting again.
  useEffect(() => {
    if (!ready) return;
    if (chatStore.getAutoApprove(workspaceId)) {
      void api()
        .invoke('session.setAutoApprove', { workspaceId, enabled: true })
        .catch(() => {});
    }
  }, [ready, workspaceId]);

  // "Send to chat" from an app (or other off-chat surface) stages a draft for
  // this workspace via composerDraftStore; drain it into the composer for the
  // user to review and send. APPEND to an in-progress draft rather than clobber
  // it (the user may have started typing), then focus + put the caret at the end
  // so Enter sends immediately. The auto-grow effect below resizes for free.
  const pendingDraft = usePendingComposerDraft(workspaceId);
  useEffect(() => {
    if (pendingDraft == null) return;
    composerDraftStore.takeDraft(workspaceId);
    setDraft((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${pendingDraft}` : pendingDraft));
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
  }, [pendingDraft, workspaceId]);

  // Auto-grow: size the textarea to its content so the composer
  // expands as the draft gains lines — whether from a Shift+Enter
  // newline or a long line soft-wrapping. Reset to 'auto' before
  // measuring so it also shrinks back when the draft is cleared or
  // trimmed. Capped at MAX_TEXTAREA_HEIGHT, past which it scrolls.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(MAX_TEXTAREA_HEIGHT, ta.scrollHeight)}px`;
  }, [draft]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter alone submits; Shift+Enter inserts a newline (the browser
    // default). ⌘↵ / Ctrl+↵ also submit so terminal-muscle-memory
    // users aren't surprised.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
    }
  };

  const onVoiceClick = useCallback(() => {
    if (voice.phase === 'recording') {
      voice.toggle();
      return;
    }
    if (!hasTranscriber) {
      setNoTranscriberMsg('No transcriber configured on the runner.');
      if (noTranscriberTimer.current !== undefined) {
        window.clearTimeout(noTranscriberTimer.current);
      }
      noTranscriberTimer.current = window.setTimeout(() => setNoTranscriberMsg(null), 2500);
      return;
    }
    voice.toggle();
  }, [hasTranscriber, voice]);

  // Clear the pending "no transcriber" toast timer on unmount.
  useEffect(
    () => () => {
      if (noTranscriberTimer.current !== undefined) {
        window.clearTimeout(noTranscriberTimer.current);
      }
    },
    [],
  );

  // "+" overflow tools. Mode joins as a disclosure submenu once session.info is
  // ready (collaboration modes filtered out by the hook); it's locked while a
  // turn is in flight, matching the old chip.
  const overflowItems: OverflowMenuItem[] = [
    { icon: 'spark', label: 'Actions', onClick: () => setActionsOpen(true) },
    { icon: 'agent', label: 'Goal', onClick: () => setGoalOpen(true) },
    {
      icon: 'check',
      label: autoApprove ? 'Auto-approve ON' : 'Auto-approve',
      onClick: () => setAutoApprove(!autoApprove),
      active: autoApprove,
    },
  ];
  if (agent.info) {
    overflowItems.push({
      icon: 'sliders',
      label: 'Mode',
      active: modeBadge != null,
      disabled: !ready || inFlight || agent.modes.length === 0,
      submenu: {
        value: agent.info.activeMode ?? '',
        options: agent.modes,
        onSelect: (m) => agent.onMode(m),
      },
    });
  }

  return (
    <form
      data-testid="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        margin: '12px 18px 4px',
        padding: '12px 14px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 16,
        boxShadow: 'var(--color-card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {modeBadge && <ModeBanner badge={modeBadge} />}
      {(attachments.length > 0 || queued.length > 0) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            paddingBottom: 4,
          }}
        >
          {attachments.map((a) => (
            <AttachmentChip
              key={a.path}
              name={a.name}
              path={a.path}
              preview={attachmentPreviews.get(a.path)}
              onPreview={onPreviewImage}
              onRemove={() => removeAttachment(a.path)}
            />
          ))}
          {queued.map((q) => (
            <QueuedChip
              key={q.id}
              text={q.prompt}
              onRemove={() => chatStore.dropFromQueue(workspaceId, q.id)}
            />
          ))}
        </div>
      )}
      {compacting && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            marginBottom: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--color-primary-strong)',
            background: 'var(--color-primary-soft)',
            borderRadius: 9,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 13,
              height: 13,
              borderRadius: '50%',
              border: '2px solid var(--color-primary-soft)',
              borderTopColor: 'var(--color-primary)',
              animation: 'moxxy-spin 0.8s linear infinite',
            }}
          />
          Compacting context — summarizing older turns to free up the window…
        </div>
      )}
      <textarea
        ref={taRef}
        data-testid="composer-input"
        aria-label="prompt"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={
          compacting
            ? 'Compacting context…'
            : attachments.length > 0
              ? 'Ask about the attached file…'
              : ready
                ? 'Send a message to the agent…'
                : 'Waiting for runner…'
        }
        disabled={!ready || compacting}
        rows={1}
        style={{
          width: '100%',
          resize: 'none',
          maxHeight: MAX_TEXTAREA_HEIGHT,
          overflowY: 'auto',
          padding: '4px 6px 6px',
          fontSize: 14.5,
          lineHeight: 1.55,
          color: 'var(--color-text)',
          background: 'transparent',
          border: 'none',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <OverflowMenu
          highlighted={autoApprove || modeBadge != null}
          items={overflowItems}
        />
        <ToolChip label="Attach file" onClick={() => void onAttach()}>
          <Icon name="attach" size={16} />
          <span>Attach</span>
        </ToolChip>
        <ToolChip
          label={voice.phase === 'recording' ? 'Stop recording' : 'Voice input'}
          onClick={onVoiceClick}
          tone={
            voice.phase === 'recording'
              ? 'recording'
              : voice.phase === 'transcribing'
                ? 'busy'
                : 'idle'
          }
        >
          <Icon name="mic" size={16} />
          <span>
            {voice.phase === 'recording'
              ? 'Listening…'
              : voice.phase === 'transcribing'
                ? 'Transcribing…'
                : 'Voice'}
          </span>
        </ToolChip>
        <span style={{ flex: 1 }} />
        {agent.info && (
          <ModelContextControl
            workspaceId={workspaceId}
            info={agent.info}
            selectedModel={agent.selectedModel}
            disabled={!ready}
            onPick={agent.onPickProviderModel}
          />
        )}
        {inFlight ? (
          <button
            type="button"
            className="btn-cta"
            data-testid="composer-abort"
            onClick={onAbort}
            style={sendBtn('var(--color-red)', true)}
            aria-label="Abort"
          >
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button
            type="submit"
            className="btn-cta"
            data-testid="composer-send"
            disabled={!canSubmit}
            style={sendBtn('var(--color-send)', canSubmit)}
            aria-label="Send"
          >
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
      {(voice.errorReason ?? noTranscriberMsg ?? attachError) && (
        <p
          role="status"
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--color-red)',
          }}
        >
          {voice.errorReason ?? noTranscriberMsg ?? attachError}
        </p>
      )}
      {actionsOpen && (
        <CommandPalette
          workspaceId={workspaceId}
          onClose={() => setActionsOpen(false)}
        />
      )}
      {goalOpen && (
        <GoalModal
          defaultObjective={draft}
          onCancel={() => setGoalOpen(false)}
          onStart={startGoal}
        />
      )}
    </form>
  );
}
