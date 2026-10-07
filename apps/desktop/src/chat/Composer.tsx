import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { api } from '@moxxy/client-core';
import { useQueuedTurns } from '@moxxy/client-core';
import { chatStore } from '@moxxy/client-core';
import { composerDraftStore, usePendingComposerDraft } from '@moxxy/client-core';
import { focusComposerPulse } from '@/lib/chatPulses';
import { usePalettePlaces } from '../shell/navigation/usePalettePlaces';
import type { AgentSession } from './agent-picker/useAgentSession';
import { CommandPalette } from './CommandPalette';
import { ComposerButton } from './composer/ComposerButton';
import { ComposerStatus } from './composer/ComposerStatus';
import { SendButton } from './composer/SendButton';
import { OverflowMenu, type OverflowMenuItem } from './composer/OverflowMenu';
import { QueuedChip } from './composer/QueuedChip';
import { AttachmentChip } from './composer/AttachmentChip';
import { MentionMenu } from './composer/MentionMenu';
import { useComposerMentions } from './composer/useComposerMentions';
import { useAutoGrow } from './composer/useAutoGrow';
import { useDictation } from './composer/useDictation';
import {
  useComposerAttachments,
  type ComposerAttachment,
} from './composer/useComposerAttachments';
import { useComposerSubmit } from './composer/useComposerSubmit';
import { useAttachmentImagePreviews } from './image-preview/useAttachmentImagePreviews';
import type { ImagePreviewItem } from './image-preview/types';
import { DEFAULT_MODE, GOAL_PLACEHOLDER, modeMeta } from './modes/mode-meta';
import { useActiveMode } from './modes/useActiveMode';

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
  /** While a voice conversation is open the rail owns the microphone, so the
   *  composer hides its dictation button and the menu entry that would start a
   *  second conversation. Typing, attachments and Send stay. */
  readonly voiceModeActive?: boolean;
  readonly onOpenVoiceCall: () => void;
  readonly onSend: (
    prompt: string,
    attachments?: ReadonlyArray<ComposerAttachment>,
  ) => void;
  readonly onAbort: () => void;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}

/**
 * The composer: one card at the foot of the conversation.
 *
 *   [+]  the field                         [mic] [send]
 *
 *   Enter         send, or queue while a turn is in flight
 *   Shift+Enter   newline
 *   ⌘↵ / Ctrl+↵   send (kept for terminal muscle memory)
 *   Esc           stand down an armed goal, else clear the draft
 *
 * Everything that is not typing or sending lives in the "+" menu. What the
 * next turn will do is said above the field only when it is not the default
 * (a mode other than the default one, auto-approve, an armed goal); the model
 * is read in the header.
 *
 * Pasting an image attaches it: the main process writes the bytes to a temp
 * file and it joins the staged attachments. The field grows with the draft.
 */
export function Composer({
  agent,
  ready,
  sending,
  compacting,
  activeTurnId,
  workspaceId,
  voiceModeActive = false,
  onOpenVoiceCall,
  onSend,
  onAbort,
  onPreviewImage,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const dictation = useDictation({
    workspaceId,
    ready,
    suspended: voiceModeActive,
    onTranscript: (t) => setDraft((d) => (d ? `${d.trimEnd()} ${t}` : t)),
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  // A goal is a state of the composer, not a dialog: arming it reuses the draft
  // already typed and the same send path.
  const [goalArmed, setGoalArmed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /** Stable callback for the attachment hooks to refocus the textarea. */
  const focusInput = useCallback(() => taRef.current?.focus(), []);

  // Shell-owned shortcuts (⌘K / ⌘L) landing on the state that owns them.
  const palette = usePalettePlaces();
  focusComposerPulse.use(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  });

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
  const mentions = useComposerMentions(agent.info?.skills, draft, setDraft, taRef);
  const closeGoal = useCallback(() => setGoalArmed(false), []);

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
  // Every mode but the default one is said above the field, the same way.
  const mode = useActiveMode(workspaceId, agent.info);
  const inMode = mode !== null && mode !== DEFAULT_MODE;

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
  // so Enter sends immediately.
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

  useAutoGrow(taRef, draft, MAX_TEXTAREA_HEIGHT);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // The open @ menu has the arrows, Enter/Tab and Escape before anything else.
    if (mentions.handleKey(e)) return;
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

  // The "+" menu. Mode joins as a submenu once session.info is ready
  // (collaboration modes are filtered out by the hook) and locks while a turn
  // is in flight.
  const overflowItems: OverflowMenuItem[] = [
    // Attach leads: it is the one reached for most often.
    { icon: 'attach', label: 'Attach file', onClick: () => void onAttach() },
    { icon: 'spark', label: 'Actions', onClick: () => setActionsOpen(true) },
    {
      icon: 'agent',
      label: goalArmed ? 'Stand down goal' : 'Set a goal',
      active: goalArmed,
      // A TOGGLE. Arming from a menu that cannot also disarm leaves the only way
      // out as Escape in the textarea, which nothing on screen says.
      onClick: () => {
        setGoalArmed((armed) => !armed);
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
  if (!voiceModeActive) {
    overflowItems.push({
      icon: 'phone',
      label: 'Voice conversation',
      disabled: !ready || compacting || inFlight,
      onClick: onOpenVoiceCall,
    });
  }
  if (agent.info) {
    overflowItems.push({
      icon: 'sliders',
      label: 'Mode',
      active: inMode,
      disabled: !ready || inFlight || agent.modes.length === 0,
      submenu: {
        value: agent.info.activeMode ?? '',
        options: agent.modes.map((m) => {
          const meta = modeMeta(m);
          return { value: m, label: meta.label, hint: meta.hint || undefined };
        }),
        onSelect: (m) => agent.onMode(m),
      },
    });
  }

  const notice = dictation.notice ?? attachError;
  const sendAction = goalArmed ? 'Start goal' : queued.length > 0 ? 'Queue' : 'Send';

  return (
    <form
      data-testid="composer"
      className="cmdbar"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="cmdbar__card">
        <ComposerStatus
          mode={mode}
          modeBusy={!ready || inFlight}
          onLeaveMode={
            agent.modes.includes(DEFAULT_MODE) ? () => agent.onMode(DEFAULT_MODE) : undefined
          }
          autoApprove={autoApprove}
          goalArmed={goalArmed}
          onStandDownGoal={closeGoal}
        />
        {(attachments.length > 0 || queued.length > 0) && (
          <div className="cmdbar__pending">
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
          <div className="cmdbar__notice" role="status">
            <span className="spinner" aria-hidden />
            Compacting context — summarizing older turns to free up the window…
          </div>
        )}
        <div className="cmdbar__in">
          {mentions.open && (
            <MentionMenu options={mentions.options} active={mentions.active} onPick={mentions.pick} />
          )}
          <OverflowMenu highlighted={autoApprove || inMode} items={overflowItems} />
          <textarea
            ref={taRef}
            data-testid="composer-input"
            aria-label="prompt"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              mentions.trackCaret(e.target);
            }}
            onSelect={(e) => mentions.trackCaret(e.currentTarget)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholderFor({
              ready,
              compacting,
              goalArmed,
              inFlight,
              hasAttachments: attachments.length > 0,
              mode,
            })}
            disabled={!ready || compacting}
            rows={1}
            className="cmdbar__ta"
          />
          <div className="cmdbar__acts">
            {!voiceModeActive && (
              <ComposerButton
                label={dictation.phase === 'recording' ? 'Stop recording' : 'Voice input'}
                wide={dictation.phase !== 'idle'}
                onClick={dictation.press}
                tone={
                  dictation.phase === 'recording'
                    ? 'recording'
                    : dictation.phase === 'transcribing'
                      ? 'busy'
                      : 'idle'
                }
              >
                <Icon name="mic" size={16} />
                {/* The word shows only while recording or transcribing: states
                    that have to be readable without hovering. */}
                {dictation.phase !== 'idle' && (
                  <span>{dictation.phase === 'recording' ? 'Listening…' : 'Transcribing…'}</span>
                )}
              </ComposerButton>
            )}
            <SendButton
              running={inFlight}
              action={sendAction}
              disabled={!canSubmit}
              onStop={onAbort}
            />
          </div>
        </div>
      </div>
      {notice && (
        <p className="cmdbar__error" role="status">
          {notice}
        </p>
      )}
      {actionsOpen && (
        <CommandPalette
          workspaceId={workspaceId}
          places={palette.places}
          onPlace={palette.onPlace}
          onClose={() => setActionsOpen(false)}
        />
      )}
    </form>
  );
}

/** What the empty field says. It names the one thing that differs from an
 *  ordinary message: a lock, a goal, a queue, what the mode works on. */
function placeholderFor(state: {
  readonly ready: boolean;
  readonly compacting: boolean;
  readonly goalArmed: boolean;
  readonly inFlight: boolean;
  readonly hasAttachments: boolean;
  readonly mode: string | null;
}): string {
  if (state.compacting) return 'Compacting context…';
  if (!state.ready) return 'Waiting for runner…';
  if (state.goalArmed) return GOAL_PLACEHOLDER;
  if (state.inFlight) return 'Queue a follow-up…';
  if (state.hasAttachments) return 'Ask about the attached file…';
  return (state.mode !== null && modeMeta(state.mode).placeholder) || 'Message Moxxy…';
}
