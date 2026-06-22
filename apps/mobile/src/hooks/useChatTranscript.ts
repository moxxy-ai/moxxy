import { useMemo } from 'react';
import type { MobileState } from '../protocol';
import { appendStreamingTranscript, buildCommittedChatTranscript } from '../chatTranscript';

export function useChatTranscript(state: MobileState) {
  const committedItems = useMemo(
    () => buildCommittedChatTranscript(state.chatEvents),
    [state.chatEvents],
  );
  const items = useMemo(
    () => appendStreamingTranscript(committedItems, state.streamingText),
    [committedItems, state.streamingText],
  );
  return {
    items,
    events: state.chatEvents,
    streamingText: state.streamingText,
    sending: state.sending,
    activeTurnId: state.activeTurnId,
    queue: state.queue,
    compacting: state.compacting,
    usage: state.usage,
    isEmpty: items.length === 0,
  };
}
