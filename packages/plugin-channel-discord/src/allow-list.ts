import type { InboundMessage } from './schema.js';

/**
 * Where the paired principal may drive the session from:
 *   - their own DM with the bot — always allowed once paired;
 *   - a guild channel — only when that channel id is on the allow-list
 *     (managed by the paired user via the local /allow and /deny commands).
 *
 * Authorship is checked FIRST: a message from anyone but the paired user never
 * reaches the session, no matter where it was sent (single-operator model,
 * matching Telegram's single paired chat).
 */
export type GateVerdict =
  | { readonly ok: true; readonly context: 'dm' | 'guild' }
  | {
      readonly ok: false;
      readonly reason: 'not-paired' | 'foreign-user' | 'channel-not-allowed';
    };

export function gateInbound(
  msg: Pick<InboundMessage, 'authorId' | 'guildId' | 'channelId'>,
  authorizedUserId: string | null,
  allowedChannels: ReadonlySet<string>,
): GateVerdict {
  if (!authorizedUserId) return { ok: false, reason: 'not-paired' };
  if (msg.authorId !== authorizedUserId) return { ok: false, reason: 'foreign-user' };
  if (msg.guildId == null) return { ok: true, context: 'dm' };
  if (allowedChannels.has(msg.channelId)) return { ok: true, context: 'guild' };
  return { ok: false, reason: 'channel-not-allowed' };
}
