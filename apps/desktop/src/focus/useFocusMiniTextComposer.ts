import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { chatStore, useQueuedTurns, type UseChat } from '@moxxy/client-core';
import {
  useComposerAttachments,
  type ComposerAttachment,
} from '@/chat/composer/useComposerAttachments';
import { useAttachmentImagePreviews } from '@/chat/image-preview/useAttachmentImagePreviews';
import { useImagePreview } from '@/chat/image-preview/useImagePreview';
import type { ImagePreviewItem } from '@/chat/image-preview/types';
import { runSessionCommand } from '@/chat/command-palette/run-command';
import { stepsForCommand } from '@/chat/command-palette/steppers';
import { composerPlaceholder } from '@/chat/composer/composer-placeholder';
import type { SendAction } from '@/chat/composer/SendButton';
import { useSlashMenu, type SlashMenu, type SlashSession } from '@/chat/composer/slash/useSlashMenu';
import { useFocusSessionState, type FocusSessionState } from './useFocusSessionState';

export interface FocusMiniTextComposer {
  readonly inputRef: RefObject<HTMLTextAreaElement>;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  readonly attachmentPreviews: ReadonlyMap<string, ImagePreviewItem>;
  readonly attachError: string | null;
  readonly dismissAttachError: () => void;
  readonly onPaste: ReturnType<typeof useComposerAttachments>['onPaste'];
  readonly removeAttachment: (path: string) => void;
  readonly canSubmit: boolean;
  readonly sending: boolean;
  /** A turn is running: the send button is Stop and a new message queues. */
  readonly running: boolean;
  readonly sendAction: SendAction;
  readonly placeholder: string;
  /** The mode and auto-approve of the session, as the desktop composer says them. */
  readonly session: FocusSessionState;
  /** The desktop composer's slash menu, over this field. */
  readonly slash: SlashMenu;
  /** A goal waits for its objective: the next send starts the run. */
  readonly goalArmed: boolean;
  readonly standDownGoal: () => void;
  readonly queued: ReadonlyArray<{
    readonly key: string;
    readonly prompt: string;
    readonly onRemove: () => void;
  }>;
  readonly submit: () => void;
  readonly abort: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly imagePreview: ReturnType<typeof useImagePreview>;
}

const MAX_TEXTAREA_HEIGHT = 112;

export function useFocusMiniTextComposer({
  workspaceId,
  remoteQueuedTurns,
  onRemoveRemoteQueuedTurn,
  chat,
}: {
  readonly workspaceId: string | null;
  readonly remoteQueuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
  readonly onRemoveRemoteQueuedTurn: (id: string) => void;
  readonly chat: UseChat;
}): FocusMiniTextComposer {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const localQueuedTurns = useQueuedTurns(workspaceId);
  const {
    attachments,
    removeAttachment,
    clearAttachments,
    attachError,
    dismissAttachError,
    onPaste,
  } = useComposerAttachments(focusInput);
  const attachmentPreviews = useAttachmentImagePreviews(workspaceId ?? undefined, attachments);
  const imagePreview = useImagePreview();
  const session = useFocusSessionState(workspaceId);
  const [goalArmed, setGoalArmed] = useState(false);
  const standDownGoal = useCallback(() => setGoalArmed(false), []);
  const trimmedDraft = draft.trim();
  const running = chat.activeTurnId !== null || chat.sending;
  const canSubmit =
    Boolean(workspaceId) &&
    !chat.compacting &&
    (trimmedDraft.length > 0 || attachments.length > 0);

  // The mode is awaited before the turn is sent, so the prompt never runs under the previous one.
  const startIn = (mode: string, prompt: string): void => {
    const staged = attachments.length > 0 ? attachments : undefined;
    setDraft('');
    clearAttachments();
    void session.setMode(mode).then(() => chat.send(prompt, staged));
  };

  const slashSource = useMemo(
    (): SlashSession => ({
      modes: session.modes,
      activeMode: session.mode,
      modeBusy: running,
      autoApprove: session.autoApprove,
      skills: session.skills,
      commands: session.commands,
    }),
    [session.modes, session.mode, session.autoApprove, session.skills, session.commands, running],
  );
  const slash = useSlashMenu(slashSource, draft, setDraft, {
    setMode: (mode) => void session.setMode(mode),
    startIn,
    armGoal: () => setGoalArmed(true),
    toggleAutoApprove: () => session.setAutoApprove(!session.autoApprove),
    // This window has no room for an action's form: its words are typed after its name.
    runCommand: (command, args) => {
      if (args === '' && stepsForCommand(command.name).length > 0) setDraft(`/${command.name} `);
      else if (workspaceId) void runSessionCommand(workspaceId, command, args);
    },
  });

  const submit = (): void => {
    if (!canSubmit) return;
    if (goalArmed) {
      if (trimmedDraft.length === 0) return;
      setGoalArmed(false);
      startIn('goal', trimmedDraft);
      return;
    }
    if (slash.submit()) return;
    void chat.send(trimmedDraft, attachments.length > 0 ? attachments : undefined);
    setDraft('');
    clearAttachments();
  };

  const abort = useCallback((): void => {
    void chat.abort();
  }, [chat.abort]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slash.handleKey(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && goalArmed) {
      event.preventDefault();
      setGoalArmed(false);
    }
  };

  const removeQueued = useCallback((id: string): void => {
    if (workspaceId) chatStore.dropFromQueue(workspaceId, id);
  }, [workspaceId]);
  const queued = useMemo(() => [
    ...localQueuedTurns.map((turn) => ({
      key: `local:${turn.id}`,
      prompt: turn.prompt,
      onRemove: () => removeQueued(turn.id),
    })),
    ...remoteQueuedTurns.map((turn) => ({
      key: `remote:${turn.id}`,
      prompt: turn.prompt,
      onRemove: () => onRemoveRemoteQueuedTurn(turn.id),
    })),
  ], [
    localQueuedTurns,
    onRemoveRemoteQueuedTurn,
    remoteQueuedTurns,
    removeQueued,
  ]);

  return {
    inputRef,
    draft,
    setDraft,
    attachments,
    attachmentPreviews,
    attachError,
    dismissAttachError,
    onPaste,
    removeAttachment,
    canSubmit,
    sending: chat.sending,
    running,
    sendAction: goalArmed ? 'Start goal' : queued.length > 0 ? 'Queue' : 'Send',
    placeholder: workspaceId
      ? composerPlaceholder({
          ready: true,
          compacting: chat.compacting,
          goalArmed,
          inFlight: running,
          hasAttachments: attachments.length > 0,
          mode: session.mode,
        })
      : 'No active workspace',
    session,
    slash,
    goalArmed,
    standDownGoal,
    queued,
    submit,
    abort,
    onKeyDown,
    imagePreview,
  };
}
