import type { ChatSnapshot } from '@moxxy/client-core';

/** A chat is answering from the moment a prompt is sent until its turn ends. */
export function turnInFlight(chat: Pick<ChatSnapshot, 'sending' | 'activeTurnId'>): boolean {
  return chat.sending || chat.activeTurnId !== null;
}
