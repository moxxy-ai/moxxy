import { useEffect, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

export interface UseChannelChat {
  /** The chat id (`workspaceId`) of the bot's conversation; null until opened. */
  readonly workspaceId: string | null;
  readonly error: string | null;
}

/**
 * A channel bot's conversation as an ordinary chat (`channels.openChat`): the
 * host attaches to the bot's own runner and hands back the chat id, so the
 * regular chat hooks + surface drive it — messages from the channel and from
 * the app land in one conversation.
 */
export function useChannelChat(channelId: string): UseChannelChat {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setWorkspaceId(null);
    setError(null);
    api()
      .invoke('channels.openChat', { channelId })
      .then((opened) => {
        if (current) setWorkspaceId(opened.workspaceId);
      })
      .catch((e: unknown) => {
        if (current) setError(toErrorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [channelId]);

  return { workspaceId, error };
}
