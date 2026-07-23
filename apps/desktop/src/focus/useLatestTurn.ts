import { useSyncExternalStore } from 'react';
import { chatStore } from '@moxxy/client-core';
import type { MoxxyEvent, UserPromptAttachment } from '@moxxy/sdk';

export interface LatestFocusTurn {
  readonly key: string;
  readonly turnId: string;
  readonly userText: string;
  readonly userAttachments: ReadonlyArray<UserPromptAttachment>;
  readonly assistantText: string;
  readonly assistantLive: boolean;
}

const EMPTY_ATTACHMENTS: ReadonlyArray<UserPromptAttachment> = Object.freeze([]);
const CACHE_MAX = 64;
const turnCache = new Map<string, { readonly key: string; readonly turn: LatestFocusTurn }>();

function latestPrompt(events: ReadonlyArray<MoxxyEvent>): Extract<MoxxyEvent, {
  readonly type: 'user_prompt';
}> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'user_prompt') return event;
  }
  return null;
}

function assistantForTurn(
  events: ReadonlyArray<MoxxyEvent>,
  turnId: string,
): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.turnId !== turnId) continue;
    if (
      event.type === 'assistant_message'
      && event.stopReason === 'end_turn'
      && event.content.trim()
    ) {
      return event.content;
    }
  }
  return '';
}

function readLatestTurn(workspaceId: string | null): LatestFocusTurn | null {
  if (!workspaceId) return null;
  const snapshot = chatStore.getChat(workspaceId);
  const prompt = latestPrompt(snapshot.events);
  if (!prompt) {
    turnCache.delete(workspaceId);
    return null;
  }

  const assistantLive = snapshot.activeTurnId === prompt.turnId
    && snapshot.streamingText.trim().length > 0;
  const assistantText = assistantLive
    ? snapshot.streamingText
    : assistantForTurn(snapshot.events, prompt.turnId);
  const attachments = prompt.attachments ?? EMPTY_ATTACHMENTS;
  const attachmentKey = attachments
    .map((attachment) => `${attachment.kind}:${attachment.name ?? ''}:${attachment.content.length}`)
    .join('|');
  const key = [
    prompt.id ?? prompt.turnId,
    prompt.text.length,
    attachmentKey,
    assistantLive ? 'live' : 'committed',
    assistantText.length,
    assistantText.slice(-64),
  ].join(':');
  const cached = turnCache.get(workspaceId);
  if (cached?.key === key) return cached.turn;

  const turn: LatestFocusTurn = {
    key,
    turnId: prompt.turnId,
    userText: prompt.text,
    userAttachments: attachments,
    assistantText,
    assistantLive,
  };
  turnCache.set(workspaceId, { key, turn });
  while (turnCache.size > CACHE_MAX) {
    const oldest = turnCache.keys().next().value;
    if (oldest === undefined) break;
    turnCache.delete(oldest);
  }
  return turn;
}

export function useLatestTurn(workspaceId: string | null): LatestFocusTurn | null {
  return useSyncExternalStore(chatStore.subscribe, () => readLatestTurn(workspaceId));
}
