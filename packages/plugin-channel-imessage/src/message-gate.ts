import { normalizeHandle, parseDmChatGuid } from './keys.js';
import { messageSchema } from './schema.js';

/**
 * The single inbound gate every session-reaching path goes through (AGENTS.md:
 * gate EVERY session-reaching path behind pairing; A8: zod-validate inbound
 * before it touches the session). Pure — the channel feeds it the raw
 * BlueBubbles `new-message` payload plus its identity/allow-list state and
 * branches on the verdict.
 *
 * Order of checks (each is load-bearing, mirroring the WhatsApp gate):
 *  1. shape-validate + size-cap the consumed fields (zod).
 *  2. drop own echoes: BlueBubbles emits `new-message` for the account's OWN
 *     sends too (our replies come back `isFromMe`), so without the sent-id check
 *     the bot would answer itself in a loop — and a self-chat reply would be
 *     mistaken for a fresh owner prompt.
 *  3. direct messages only (v1): a group chat GUID is dropped — group fan-in
 *     needs its own trust story.
 *  4. drop `isFromMe` messages outside the owner's self-chat: those are the
 *     owner talking to OTHER people from an Apple device — never a prompt. Only
 *     `isFromMe` in a 1:1 chat with one of the owner's own handles drives a turn.
 *  5. allow-list by normalized handle for inbound (non-`isFromMe`) messages.
 *     Unauthorized senders are dropped SILENTLY — replying would leak the bot's
 *     existence.
 */

export type GateVerdict =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly chatGuid: string; readonly text: string };

export interface GateState {
  /** The owner's own normalized handle(s) — the self-chat identities. */
  readonly ownerHandles: ReadonlySet<string>;
  /** Normalized handles of OTHER people allowed to drive the session. */
  readonly allowedHandles: ReadonlySet<string>;
  /** True for a guid/tempGuid of THIS channel's own recent send (echo/loop protection). */
  readonly isOwnSend: (id: string) => boolean;
}

export function gateInboundMessage(state: GateState, raw: unknown): GateVerdict {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return drop('invalid message shape');
  const message = parsed.data;

  const chats = message.chats;
  const firstChat = chats && chats.length > 0 ? chats[0] : undefined;
  if (!firstChat) return drop('message without a chat');
  const chatGuid = firstChat.guid;

  // Own-echo drop FIRST — a reply we sent into a self-chat comes back isFromMe
  // and would otherwise re-enter as an owner prompt (loop).
  if (state.isOwnSend(message.guid)) return drop('own outbound echo (guid)');
  const tempGuid = message.tempGuid;
  if (tempGuid && state.isOwnSend(tempGuid)) return drop('own outbound echo (tempGuid)');

  const dm = parseDmChatGuid(chatGuid);
  if (!dm) return drop('not a 1:1 direct message');

  if (message.isFromMe === true) {
    // Same-account messages: only the owner's own self-chat is a prompt surface.
    if (!state.ownerHandles.has(dm.handle)) {
      return drop('own message in a foreign chat');
    }
  } else {
    const senderHandle = resolveSender(message.handle, dm.handle);
    if (!state.allowedHandles.has(senderHandle)) {
      return drop('sender not allow-listed');
    }
  }

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text.length === 0) return drop('no message text');

  return { ok: true, chatGuid, text };
}

/**
 * The sender's handle for an inbound message: the message's own `handle`
 * address when present, else the 1:1 chat's counterpart (they are the same
 * party in a DM). Narrowed once, then plain access — no optional-chain depth.
 */
function resolveSender(
  handle: { readonly address?: string | null } | null | undefined,
  chatHandle: string,
): string {
  if (handle && typeof handle.address === 'string' && handle.address.length > 0) {
    return normalizeHandle(handle.address);
  }
  return chatHandle;
}

function drop(reason: string): GateVerdict {
  return { ok: false, reason };
}
