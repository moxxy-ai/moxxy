import { useMemo } from 'react';
import type { MobileState } from '../protocol';
import { buildChatTranscript } from '../chatTranscript';

export function useChatTranscript(state: MobileState) {
  // chatEvents is reference-stable across streaming ticks (client-core keeps
  // the committed-events array identity), so the fold only re-runs when a
  // committed event lands or the live preview changes.
  const items = useMemo(
    () => buildChatTranscript(state.chatEvents, state.streamingText),
    [state.chatEvents, state.streamingText],
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
