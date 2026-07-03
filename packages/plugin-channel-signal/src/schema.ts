import { z } from 'zod';

/**
 * Zod validation for signal-cli `receive` notification params — every inbound
 * envelope is validated + size-capped BEFORE any field reaches the session
 * (channel invariant A8). We only type the fields the channel consumes;
 * unknown extras pass through untouched so a newer signal-cli doesn't fail
 * validation, but nothing un-modeled is ever read.
 */

/** Cap on inbound prompt text we will forward to the model. */
export const MAX_INBOUND_TEXT_CHARS = 16_000;

/**
 * Attachment ids become filenames under signal-cli's attachments dir; a strict
 * charset (no separators, no dots-only names) makes path traversal impossible
 * before we ever join() it.
 */
export const attachmentIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'invalid attachment id');

export const attachmentSchema = z
  .object({
    id: attachmentIdSchema.optional(),
    contentType: z.string().max(128).optional(),
    filename: z.string().max(512).nullable().optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type SignalAttachment = z.infer<typeof attachmentSchema>;

const groupInfoSchema = z
  .object({
    groupId: z.string().max(256).optional(),
  })
  .passthrough();

const dataMessageSchema = z
  .object({
    timestamp: z.number().int().optional(),
    message: z.string().max(MAX_INBOUND_TEXT_CHARS).nullable().optional(),
    groupInfo: groupInfoSchema.nullable().optional(),
    attachments: z.array(attachmentSchema).max(16).optional(),
  })
  .passthrough();

/**
 * A sync'd copy of a message the ACCOUNT OWNER sent from another of their
 * devices (their phone, Signal Desktop, …). "Note to Self" prompts arrive this
 * way — and so can echoes of our OWN sends, which is why the channel filters
 * these by sent-timestamp before acting (loop protection).
 */
const sentMessageSchema = z
  .object({
    timestamp: z.number().int().optional(),
    message: z.string().max(MAX_INBOUND_TEXT_CHARS).nullable().optional(),
    destination: z.string().max(128).nullable().optional(),
    destinationNumber: z.string().max(32).nullable().optional(),
    destinationUuid: z.string().max(64).nullable().optional(),
    groupInfo: groupInfoSchema.nullable().optional(),
    attachments: z.array(attachmentSchema).max(16).optional(),
  })
  .passthrough();

const syncMessageSchema = z
  .object({
    sentMessage: sentMessageSchema.optional(),
  })
  .passthrough();

export const envelopeSchema = z
  .object({
    source: z.string().max(128).nullable().optional(),
    sourceNumber: z.string().max(32).nullable().optional(),
    sourceUuid: z.string().max(64).nullable().optional(),
    sourceName: z.string().max(256).nullable().optional(),
    sourceDevice: z.number().int().optional(),
    timestamp: z.number().int().optional(),
    dataMessage: dataMessageSchema.nullable().optional(),
    syncMessage: syncMessageSchema.nullable().optional(),
    // typingMessage / receiptMessage / receiptMessage etc. pass through and are
    // simply not consumed.
  })
  .passthrough();

export const receiveParamsSchema = z
  .object({
    account: z.string().max(64).optional(),
    envelope: envelopeSchema,
  })
  .passthrough();

export type SignalEnvelope = z.infer<typeof envelopeSchema>;
export type SignalReceiveParams = z.infer<typeof receiveParamsSchema>;
