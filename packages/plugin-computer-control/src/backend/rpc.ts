import { computerCursorSchema } from '@moxxy/sdk';
import { z } from 'zod';
import { actionResultSchema } from '../contract/outcome.js';
import { appTreeSchema } from '../contract/tree.js';

/** Protocol spoken by every helper that implements the shared contract (macOS first, Windows from v4 → v5). */
export const CONTRACT_PROTOCOL_VERSION = 5;

const id = z.string().min(1).max(512);
const name = z.string().max(512);
const appRef = z.object({ id, name }).strict();

export const statusResultSchema = z.object({
  ready: z.boolean(),
  permissions: z.object({ accessibility: z.boolean(), screenRecording: z.boolean() }).strict(),
  limitations: z.array(z.string().max(500)).max(16),
}).strict();

export const listAppsResultSchema = z.object({
  apps: z.array(appRef.extend({
    running: z.boolean(),
    windows: z.array(z.object({ id: z.string().min(1).max(160), title: z.string().max(1024) }).strict()).max(64).optional(),
  }).strict()).max(200),
  truncated: z.boolean(),
}).strict();

export const resolveAppsResultSchema = z.object({
  apps: z.array(z.discriminatedUnion('status', [
    z.object({ request: name, status: z.literal('resolved'), id, name }).strict(),
    z.object({ request: name, status: z.literal('ambiguous'), candidates: z.array(appRef).min(2).max(16) }).strict(),
    z.object({ request: name, status: z.literal('not_found') }).strict(),
  ])).max(32),
}).strict();

export const imageSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png']),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();
export type HelperImage = z.infer<typeof imageSchema>;

/** One observation of an app: its tree, plus the window image or why there is none. */
export const appStateSchema = z.object({
  tree: appTreeSchema,
  screenshot: imageSchema.optional(),
  screenshotUnavailable: z.string().max(500).optional(),
}).strict();
export type AppState = z.infer<typeof appStateSchema>;

export const actResultSchema = z.object({ result: actionResultSchema, state: appStateSchema.optional() }).strict();
export const batchResultSchema = z.object({ results: z.array(actionResultSchema).min(1).max(50), state: appStateSchema.optional() }).strict();

/** Emitted whenever the overlay cursor moves, changes phase or hides (`null`); never correlated to a request. */
export const cursorEventSchemaFor = (version: number) => z.object({
  version: z.literal(version), event: z.literal('cursor'), cursor: computerCursorSchema.nullable(),
}).strict();

/** Every uncorrelated event a contract helper may send besides `control_state`. */
export const contractEventsFor = (version: number) => ({ cursor: cursorEventSchemaFor(version) });
