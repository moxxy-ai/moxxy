import { z } from 'zod';

/**
 * Zod validation for the BlueBubbles socket.io `new-message` payload — a
 * serialized Message object. Every inbound message is validated + size-capped
 * BEFORE any field reaches the session (channel invariant A8). Only the fields
 * the channel consumes are typed; unknown extras pass through untouched so a
 * newer BlueBubbles server doesn't fail validation, but nothing un-modeled is
 * ever read.
 */

/** Cap on inbound prompt text we will forward to the model. */
export const MAX_INBOUND_TEXT_CHARS = 16_000;

/** A single participant handle on a chat / message (`{ address, ... }`). */
export const handleSchema = z
  .object({
    address: z.string().min(1).max(256).nullable().optional(),
  })
  .passthrough();

/** A chat the message belongs to. `guid` is `SERVICE;TYPE;IDENTIFIER`. */
export const chatSchema = z
  .object({
    guid: z.string().min(1).max(256),
  })
  .passthrough();

/**
 * The serialized Message. `guid` is the stable per-message id (used for the
 * anti-echo drop); `tempGuid` echoes back the value the sender chose for an
 * apple-script send, so our own replies can be recognised even before their
 * permanent guid is known.
 */
export const messageSchema = z
  .object({
    guid: z.string().min(1).max(256),
    tempGuid: z.string().min(1).max(256).nullable().optional(),
    text: z.string().max(MAX_INBOUND_TEXT_CHARS).nullable().optional(),
    isFromMe: z.boolean().nullable().optional(),
    handle: handleSchema.nullable().optional(),
    chats: z.array(chatSchema).max(16).optional(),
    dateCreated: z.number().nullable().optional(),
  })
  .passthrough();

export type ImessageMessage = z.infer<typeof messageSchema>;
