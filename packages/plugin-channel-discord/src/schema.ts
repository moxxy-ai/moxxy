/**
 * Inbound-payload validation (AGENTS.md invariant: zod-validate every inbound
 * frame/body before it touches the session). discord.js hands us rich class
 * instances; we extract ONLY the primitive fields the channel consumes into a
 * plain record and validate + size-cap that, so a malformed/hostile payload is
 * dropped at the boundary instead of flowing into handlers.
 */
import { z } from '@moxxy/sdk';
import { snowflakeSchema } from './keys.js';

/**
 * Hard cap on inbound message text we accept. Discord caps user messages at
 * 4000 chars (Nitro); anything past this is not a legitimate prompt, so we
 * drop it rather than truncate (a silently truncated prompt is worse than a
 * clear rejection).
 */
export const MAX_CONTENT_CHARS = 8_000;

/** Hard cap on an inbound audio attachment we will buffer for transcription. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const attachmentSchema = z.object({
  id: snowflakeSchema,
  url: z.string().url().max(2_048),
  contentType: z.string().max(256).nullable(),
  size: z.number().int().nonnegative(),
  name: z.string().max(1_024).nullable(),
});

export const inboundMessageSchema = z.object({
  id: snowflakeSchema,
  /** Raw message text (may be empty for attachment-only messages). */
  content: z.string().max(MAX_CONTENT_CHARS),
  channelId: snowflakeSchema,
  /** Null for DMs. */
  guildId: snowflakeSchema.nullable(),
  authorId: snowflakeSchema,
  authorIsBot: z.boolean(),
  attachments: z.array(attachmentSchema).max(16),
});

export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type InboundAttachment = z.infer<typeof attachmentSchema>;

/** The structural slice of a discord.js Message we extract fields from. */
export interface RawMessageLike {
  readonly id?: unknown;
  readonly content?: unknown;
  readonly channelId?: unknown;
  readonly guildId?: unknown;
  readonly author?: { readonly id?: unknown; readonly bot?: unknown } | null;
  readonly attachments?: {
    values?(): IterableIterator<{
      readonly id?: unknown;
      readonly url?: unknown;
      readonly contentType?: unknown;
      readonly size?: unknown;
      readonly name?: unknown;
    }>;
  } | null;
}

/**
 * Extract + validate the fields we consume from a discord.js Message. Returns
 * null when the payload doesn't validate (wrong shapes, oversized content,
 * missing ids) — the caller drops it with a warning.
 */
export function extractInboundMessage(msg: RawMessageLike): InboundMessage | null {
  const attachments: unknown[] = [];
  try {
    for (const a of msg.attachments?.values?.() ?? []) {
      attachments.push({
        id: a?.id,
        url: a?.url,
        contentType: a?.contentType ?? null,
        size: a?.size,
        name: a?.name ?? null,
      });
    }
  } catch {
    return null;
  }
  const candidate = {
    id: msg.id,
    content: msg.content,
    channelId: msg.channelId,
    guildId: msg.guildId ?? null,
    authorId: msg.author?.id,
    authorIsBot: msg.author?.bot === true,
    attachments,
  };
  const parsed = inboundMessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
