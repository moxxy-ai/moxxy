import type { MobileState } from '../protocol';
import { buildChatTranscript } from '../chatTranscript';

export function useChatTranscript(state: MobileState) {
  const items = buildChatTranscript(state.chatEvents, state.streamingText);
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
