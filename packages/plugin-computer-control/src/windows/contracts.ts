import { z } from 'zod';

export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 3_000_000;
export const idSchema = z.string().min(1).max(160);
export const controlStateSchema = z.object({
  version: z.literal(PROTOCOL_VERSION), event: z.literal('control_state'), id: idSchema,
  state: z.enum(['idle', 'background', 'foreground', 'waiting_for_focus', 'paused_by_user', 'recovering', 'stopped', 'failed']),
}).strict();
export type ControlState = z.infer<typeof controlStateSchema>;
export const controlCommandSchema = z.enum(['pause', 'resume', 'stop']);
export const observationRequiredSchema = z.object({
  status: z.literal('needs_observation'), delivered: z.literal(false),
  effect: z.enum(['none', 'possible']), verificationRequired: z.literal(true),
}).strict();
const pixel = z.number().finite().int();
export const rectangleSchema = z.object({
  x: pixel, y: pixel, width: pixel.positive(), height: pixel.positive(),
}).strict();
export const pointSchema = z.object({ x: pixel.nonnegative(), y: pixel.nonnegative() }).strict();
export const targetSchema = z.object({ windowId: idSchema }).strict();
export const appCatalogInputSchema = z.object({query:z.string().max(256).default(''),maxResults:z.number().int().min(1).max(64).default(32)}).strict();
export const appCatalogSchema = z.object({
  apps:z.array(z.object({appId:idSchema,name:z.string().max(512),source:z.enum(['system','windows-shell'])}).strict()).max(64),
  truncated:z.boolean(),
  unavailableSources:z.array(z.literal('windows-shell')).max(1),
}).strict();
export const openSchema = z.object({appId:idSchema,instance:z.enum(['reuse','new']).default('reuse'),timeoutMs:z.number().int().min(500).max(8000).default(5000)}).strict();
export const elementSchema = targetSchema.extend({ observationId: idSchema, elementId: idSchema }).strict();
const clickOptions = { button: z.enum(['left', 'right', 'middle']).default('left'), count: z.number().int().min(1).max(3).default(1) };
export const clickSchema = z.union([
  elementSchema.extend(clickOptions).strict(),
  targetSchema.extend({ captureId: idSchema, x: pixel.nonnegative(), y: pixel.nonnegative(), ...clickOptions }).strict(),
]);
export const screenshotSchema = targetSchema.extend({
  region: rectangleSchema.extend({ x: pixel.nonnegative(), y: pixel.nonnegative() }).strict().optional()
    .describe('Optional crop in physical pixels relative to the window bounds, before resizing.'),
  maxDim: z.number().int().min(256).max(3840).default(1280),
  format: z.enum(['png', 'jpeg']).default('jpeg'),
  quality: z.number().int().min(40).max(100).default(72),
  allowVisibleFallback: z.boolean().default(false),
}).strict();
export const observeSchema = targetSchema.extend({
  maxNodes: z.number().int().min(1).max(256).default(128),
  root: z.object({observationId: idSchema, elementId: idSchema}).strict().optional(),
  filter: z.object({nameIncludes: z.string().max(256).optional(), controlType: pixel.min(50000).max(60000).optional()}).strict().optional(),
}).strict();
export const typeSchema = elementSchema.extend({ text: z.string().max(4000) }).strict();
export const readTextSchema = elementSchema.extend({ maxChars: z.number().int().min(1).max(16000).default(4000) }).strict();
export const selectTextSchema = elementSchema.extend({ text: z.string().min(1).max(4000), occurrence: z.number().int().min(1).max(100).default(1) }).strict();
export const textResultSchema = z.object({
  text: z.string().max(16000), selectedText: z.array(z.string().max(16000)).max(16), truncated: z.boolean(),
}).strict();
export const keySchema = targetSchema.extend({
  observationId: idSchema,
  key: z.string().regex(/^(?:[a-z0-9]|enter|tab|escape|backspace|delete|space|home|end|pageup|pagedown|left|right|up|down|f(?:[1-9]|1[0-2]))$/),
  modifiers: z.array(z.enum(['windows', 'control', 'alt', 'shift'])).max(4).default([]),
}).strict();
export const scrollSchema = targetSchema.extend({
  captureId: idSchema, x: pixel.nonnegative(), y: pixel.nonnegative(),
  deltaX: z.number().int().min(-1200).max(1200).default(0),
  deltaY: z.number().int().min(-1200).max(1200).default(0),
}).strict();
export const dragSchema = targetSchema.extend({
  captureId: idSchema, from: pointSchema, to: pointSchema,
  durationMs: z.number().int().min(100).max(2000).default(400),
}).strict();
export const clipboardSchema = z.discriminatedUnion('action', [
  targetSchema.extend({ action: z.literal('read') }).strict(),
  targetSchema.extend({ action: z.literal('write'), text: z.string().max(64000) }).strict(),
]);
const windowIdentity = z.object({windowId:idSchema,pid:pixel.positive(),title:z.string().max(2048),className:z.string().max(255),kind:z.enum(['normal','modal','menu'])});
export const windowSchema = z.discriminatedUnion('state',[
  windowIdentity.extend({state:z.literal('normal'),bounds:rectangleSchema}).strict(),
  windowIdentity.extend({state:z.literal('minimized'),bounds:z.null()}).strict(),
]);
export const openResultSchema = z.discriminatedUnion('status',[
  z.object({appId:idSchema,status:z.literal('opened'),launched:z.literal(true),windows:z.array(windowSchema).length(1)}).strict(),
  z.object({appId:idSchema,status:z.literal('existing'),launched:z.literal(false),windows:z.array(windowSchema).length(1)}).strict(),
  z.object({appId:idSchema,status:z.literal('ambiguous'),launched:z.boolean(),windows:z.array(windowSchema).min(2).max(256)}).strict(),
  z.object({appId:idSchema,status:z.literal('no_window'),launched:z.literal(true),windows:z.array(windowSchema).length(0)}).strict(),
]);
export const observationSchema = z.object({
  windowId: idSchema, observationId: idSchema, bounds: rectangleSchema,
  focusedElementId: idSchema.nullable(), truncated: z.boolean(),
  elements: z.array(z.object({
    elementId: idSchema, parentId: idSchema.nullable(), name: z.string().max(512),
    controlType: pixel, bounds: rectangleSchema, enabled: z.boolean(), protected: z.boolean(),
    value: z.string().max(512).optional(),
  }).strict()).max(256),
}).strict();
export const captureSchema = z.object({
  windowId: idSchema, captureId: idSchema, source: rectangleSchema,
  width: pixel.positive(), height: pixel.positive(),
  mediaType: z.enum(['image/png', 'image/jpeg']), base64: z.string().max(2_000_000),
  mode: z.enum(['window', 'visible-desktop']),
}).strict();
export const statusSchema = z.object({
  platform: z.literal('win32'), architecture: z.literal('x64'), ready: z.boolean(),
  protocolVersion: z.literal(PROTOCOL_VERSION), limitations: z.array(z.string()).max(16),
}).strict();
export const responseSchema = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(PROTOCOL_VERSION), id: idSchema, ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(PROTOCOL_VERSION), id: idSchema, ok: z.literal(false),
    error: z.object({ code: z.string().max(80), message: z.string().max(2048) }).strict() }).strict(),
]);

export function imagePointToScreen(
  point: z.infer<typeof pointSchema>,
  image: { width: number; height: number },
  source: z.infer<typeof rectangleSchema>,
): { x: number; y: number } {
  pointSchema.parse(point);
  rectangleSchema.parse(source);
  rectangleSchema.parse({ x: 0, y: 0, ...image });
  if (point.x >= image.width || point.y >= image.height) throw new Error('Point outside capture');
  return {
    x: source.x + Math.min(source.width - 1, Math.floor(point.x * source.width / image.width)),
    y: source.y + Math.min(source.height - 1, Math.floor(point.y * source.height / image.height)),
  };
}
