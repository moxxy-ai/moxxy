import type { ChannelHandle, ClientSession } from '@moxxy/sdk';

/** What a registered command's `session-action` result needs from a channel. */
export interface SessionActionTarget {
  readonly session: Pick<ClientSession, 'log'> & { reset?: () => Promise<void> } | null;
  readonly turnController: AbortController | null;
  readonly handle: Pick<ChannelHandle, 'stop'> | null;
  /** The messenger's name for the `/exit` notice (`Telegram`). */
  readonly channelName: string;
  /** Settle the prompts waiting on the user (permissions, approvals). */
  readonly abortPending: (reason: string) => void;
  /** Drop the channel's per-conversation state (a pending text answer, …). */
  readonly onReset?: (action: 'new' | 'clear') => void;
  /** How long `/exit` waits so its reply is delivered before the stop. */
  readonly exitDelayMs?: number;
}

/**
 * Apply `/new`, `/clear` or `/exit` asked by a registered command (the same
 * results the TUI folds into its UI) and return the reply for the chat.
 */
export async function applySessionAction(
  action: 'new' | 'clear' | 'exit',
  notice: string | undefined,
  target: SessionActionTarget,
): Promise<string> {
  const { session } = target;
  if (!session) return 'session is not ready yet.';
  if (action === 'exit') {
    // Stop AFTER returning so the reply can still be delivered.
    setTimeout(() => void target.handle?.stop('user /exit'), target.exitDelayMs ?? 250);
    return notice ?? `closing ${target.channelName} channel`;
  }
  if (action === 'clear') {
    target.onReset?.('clear');
    return `✓ ${notice ?? 'cleared'}`;
  }
  if (target.turnController && !target.turnController.signal.aborted) {
    target.turnController.abort('user reset');
  }
  target.onReset?.('new');
  target.abortPending('session reset');
  // Wipe the history at its source (RemoteSession.reset() asks the runner; a
  // mirror-only log.clear() would desync) and only claim success when the
  // reset actually happened (AGENTS.md A10).
  try {
    if (typeof session.reset === 'function') await session.reset();
    else session.log.clear();
  } catch (err) {
    return `⚠ /new failed: ${err instanceof Error ? err.message : String(err)} — history NOT cleared`;
  }
  return `✓ ${notice ?? 'new session — conversation history cleared'}`;
}
