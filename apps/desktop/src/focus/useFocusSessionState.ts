import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import type { SkillInfo } from '@moxxy/sdk';
import type { CommandInfo } from '@/chat/command-palette/types';
import { DEFAULT_MODE } from '@/chat/modes/mode-meta';

export interface FocusSessionState {
  /** The session's active mode, or null while it is not known. */
  readonly mode: string | null;
  readonly autoApprove: boolean;
  /** What the slash menu offers: the session's modes, skills and actions. */
  readonly modes: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly commands: ReadonlyArray<CommandInfo>;
  /** Switches the session's mode; resolves once the session has it. */
  readonly setMode: (mode: string) => Promise<void>;
  readonly setAutoApprove: (enabled: boolean) => void;
  /** Go back to the default mode; absent when the session has no such mode. */
  readonly leaveMode?: () => void;
}

interface SessionTurnInfo {
  readonly mode: string | null;
  readonly autoApprove: boolean | undefined;
  readonly modes: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly commands: ReadonlyArray<CommandInfo>;
}

const UNKNOWN: SessionTurnInfo = { mode: null, autoApprove: undefined, modes: [], skills: [], commands: [] };

/**
 * What the next turn will do, read from the session itself so the focus
 * window says the same as the desktop composer: a switch made there, in the
 * TUI or by a channel bot arrives here as the session's own push.
 */
export function useFocusSessionState(workspaceId: string | null): FocusSessionState {
  const [info, setInfo] = useState<SessionTurnInfo>(UNKNOWN);
  // A runner without the shared switch reports no auto-approve; the host's
  // push, mirrored into the chat store, is the state there.
  const pushedAutoApprove = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getAutoApprove(workspaceId) : false,
  );

  useEffect(() => {
    setInfo(UNKNOWN);
    if (!workspaceId) return undefined;
    let cancelled = false;
    const read = (): void => {
      void api()
        .invoke('session.info', { workspaceId })
        .then((raw) => {
          if (cancelled || !raw) return;
          setInfo({
            mode: raw.activeMode ?? null,
            autoApprove: raw.autoApprove,
            modes: raw.modes ?? [],
            skills: raw.skills ?? [],
            commands: raw.commands ?? [],
          });
        })
        .catch(() => undefined);
    };
    const onPush = (payload: { workspaceId: string }): void => {
      if (payload.workspaceId === workspaceId) read();
    };
    read();
    const offInfo = api().subscribe('session.info.changed', onPush);
    const offAutoApprove = api().subscribe('session.autoApprove.changed', onPush);
    return () => {
      cancelled = true;
      offInfo();
      offAutoApprove();
    };
  }, [workspaceId]);

  const setMode = useCallback(
    async (mode: string): Promise<void> => {
      if (!workspaceId) return;
      setInfo((current) => ({ ...current, mode }));
      await api()
        .invoke('session.setMode', { workspaceId, mode })
        .catch(() => undefined);
    },
    [workspaceId],
  );

  const setAutoApprove = useCallback(
    (enabled: boolean): void => {
      if (!workspaceId) return;
      setInfo((current) => ({ ...current, autoApprove: enabled }));
      chatStore.setAutoApprove(workspaceId, enabled);
      void api()
        .invoke('session.setAutoApprove', { workspaceId, enabled })
        .catch(() => undefined);
    },
    [workspaceId],
  );

  const leave = useCallback((): void => void setMode(DEFAULT_MODE), [setMode]);

  return {
    mode: info.mode,
    autoApprove: info.autoApprove ?? pushedAutoApprove,
    modes: info.modes,
    skills: info.skills,
    commands: info.commands,
    setMode,
    setAutoApprove,
    leaveMode: info.modes.includes(DEFAULT_MODE) ? leave : undefined,
  };
}
