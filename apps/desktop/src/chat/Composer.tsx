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
import type { AgentSession } from './agent-picker/useAgentSession';
import { ModeBanner } from './composer/ModeBanner';
import { CommandPalette } from './CommandPalette';
import { ToolChip } from './composer/ToolChip';
import { VoiceModeButton } from './composer/VoiceModeButton';
import { OverflowMenu, type OverflowMenuItem } from './composer/OverflowMenu';
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
  /** Session info + provider/model/mode mutations, owned by ChatSurface so the
   *  instrument bar's telemetry and this composer share one fetch. */
  readonly agent: AgentSession;
  readonly ready: boolean;
  readonly sending: boolean;
  /** Runner is compacting the context — lock the composer entirely. */
  readonly compacting: boolean;
  readonly activeTurnId: string | null;
  readonly workspaceId: string;
  readonly onOpenVoiceCall: () => void;
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
  agent,
  ready,
  sending,
  compacting,
  activeTurnId,
  workspaceId,
  onOpenVoiceCall,
  onSend,
  onAbort,
  onPreviewImage,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [hasTranscriber, setHasTranscriber] = useState(false);
  const [noTranscriberMsg, setNoTranscriberMsg] = useState<string | null>(null);
  const voice = useVoiceRecorder({
    workspaceId,
    onTranscript: (t) => setDraft((d) => (d ? `${d.trimEnd()} ${t}` : t)),
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  // Goal is a STATE of the command bar, not a modal. A dialog to type one line
  // that then goes through the same send path was a second composer stacked on
  // top of the first — same textarea, same Enter-to-submit, same draft, plus a
  // backdrop and a focus trap. Arming it here reuses the draft you already typed.
  const [goalArmed, setGoalArmed] = useState(false);
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
  const closeGoal = useCallback(() => setGoalArmed(false), []);

  const inFlight = activeTurnId !== null || sending;
  const info = agent.info;
  // Model name only, matching the instrument bar's agent cell.
  const modelLabel = agent.selectedModel ?? info?.activeProvider ?? null;
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
      send();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Escape stands down the goal first; only a second press clears the draft,
      // so arming by mistake never costs you what you had written.
      if (goalArmed) setGoalArmed(false);
      else setDraft('');
    }
  };

  /** The one send path. Armed for a goal it starts a goal run; otherwise it ships
   *  the draft. Both consume the same draft, which is the point of arming rather
   *  than opening a dialog. */
  const send = (): void => {
    if (goalArmed) {
      const objective = draft.trim();
      if (objective.length === 0) return;
      setGoalArmed(false);
      startGoal(objective);
      return;
    }
    submit();
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
    // Attach leads: it is the thing reached for most often, and it used to sit
    // outside as its own button in a row that already had too many.
    { icon: 'attach', label: 'Attach file', onClick: () => void onAttach() },
    { icon: 'spark', label: 'Actions', onClick: () => setActionsOpen(true) },
    {
      icon: 'agent',
      label: goalArmed ? 'Goal armed' : 'Set a goal',
      active: goalArmed,
      onClick: () => {
        setGoalArmed(true);
        taRef.current?.focus();
      },
    },
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
        send();
      }}
      // A docked panel with a top seam, not a floating rounded card with a
      // shadow. It is permanent chrome at the foot of the field, and in this
      // language a flat surface does not cast a shadow — that is reserved for
      // things that genuinely float above the panel (menus, modals).
      className="cmdbar"
    >
      {modeBadge && <ModeBanner badge={modeBadge} />}
      {/* The status strip: what the NEXT turn will do. The instrument bar above
          reports what the run HAS done; these are the settings in force when you
          press send, which is why they belong to the composer and the telemetry
          does not. */}
      <div className="cmdbar__strip">
        {info?.activeMode && <span className="tag tag--cmd">{info.activeMode}</span>}
        {modelLabel && <span className="tag">{modelLabel}</span>}
        {autoApprove && (
          <span className="tag tag--warn" data-testid="composer-auto-approve">
            auto-approve on
          </span>
        )}
        {goalArmed && (
          <button
            type="button"
            className="tag tag--cmd"
            data-testid="composer-goal-armed"
            title="Stand down (Esc)"
            onClick={() => setGoalArmed(false)}
          >
            goal <Icon name="x" size={10} />
          </button>
        )}
        <span className="cmdbar__hint">
          {queued.length > 0 && `${queued.length} queued · `}
          {inFlight ? 'turn in flight' : 'ready'} · ⌘K commands
        </span>
      </div>
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
      <div className="cmdbar__in">
        <OverflowMenu
          highlighted={autoApprove || modeBadge != null}
          items={overflowItems}
        />
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
          className="cmdbar__ta"
          style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
        />
        <div className="cmdbar__acts">
          <ToolChip
            label={voice.phase === 'recording' ? 'Stop recording' : 'Voice input'}
            showLabel={voice.phase !== 'idle'}
            onClick={onVoiceClick}
            tone={
              voice.phase === 'recording'
                ? 'recording'
                : voice.phase === 'transcribing'
                  ? 'busy'
                  : 'idle'
            }
          >
            <Icon name="mic" size={15} />
            {/* The word appears only while recording or transcribing: those are
                states you must be able to read WITHOUT hovering. Idle voice is
                just an icon. */}
            {voice.phase !== 'idle' && (
              <span>{voice.phase === 'recording' ? 'Listening…' : 'Transcribing…'}</span>
            )}
          </ToolChip>
          <VoiceModeButton
            disabled={!ready || compacting || inFlight}
            onOpen={onOpenVoiceCall}
          />
          {inFlight ? (
            <button
              type="button"
              className="btn-cta"
              data-testid="composer-abort"
              onClick={onAbort}
              style={sendBtn('var(--color-red)', true)}
              aria-label="Abort"
            >
              <Icon name="stop" size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              className="btn-cta"
              data-testid="composer-send"
              disabled={!canSubmit}
              style={sendBtn('var(--color-send)', canSubmit)}
              aria-label={inFlight ? 'Queue' : 'Send'}
            >
              {/* Says what it will actually DO: mid-turn a submit queues behind the
                  running turn rather than sending, and the button is the only place
                  someone would look before pressing it. */}
              <span>
                {goalArmed ? 'Start goal' : queued.length > 0 || inFlight ? 'Queue' : 'Send'}
              </span>
              <Icon name="send" size={14} />
            </button>
          )}
        </div>
      </div>
      {(voice.errorReason ?? noTranscriberMsg ?? attachError) && (
        <p className="cmdbar__error" role="status">
          {voice.errorReason ?? noTranscriberMsg ?? attachError}
        </p>
      )}
      <p className="cmdbar__keys">
        {inFlight ? 'Enter queues behind the running turn' : 'Enter sends'} · Shift+Enter
        newline · Esc clears
      </p>
      {actionsOpen && (
        <CommandPalette
          workspaceId={workspaceId}
          onClose={() => setActionsOpen(false)}
        />
      )}

    </form>
  );
}
