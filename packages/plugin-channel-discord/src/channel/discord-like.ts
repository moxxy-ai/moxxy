/**
 * Structural slices of the discord.js surface the handlers touch. Keeping the
 * handlers typed against these (instead of discord.js classes) keeps the
 * messenger-specific transport at the channel edge and lets unit tests drive
 * every gating / streaming / pairing path with plain fake objects — no gateway
 * connection, no discord.js instances.
 */

/** A message we sent and can edit in place (the streamed frame). */
export interface SentMessageLike {
  edit(content: string): Promise<unknown>;
}

/** Payload accepted by `send` — text plus optional component rows (buttons) or
 *  file attachments (a synthesized voice reply). `content` is optional so a
 *  file-only message (audio, no text) is expressible. */
export interface OutboundPayload {
  readonly content?: string;
  readonly components?: ReadonlyArray<unknown>;
  /** File attachments (e.g. a discord.js `AttachmentBuilder`). */
  readonly files?: ReadonlyArray<unknown>;
}

/** A channel (DM or guild text channel) we can post into. */
export interface SendableChannelLike {
  send(payload: string | OutboundPayload): Promise<SentMessageLike>;
  /** Discord's typing indicator lasts ~10s per call; refresh to keep it alive. */
  sendTyping?(): Promise<unknown>;
}

export interface ChannelLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}
