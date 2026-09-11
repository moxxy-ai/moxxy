import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 3_000_000;
export const idSchema = z.string().min(1).max(160);
const pixel = z.number().finite().int();
export const rectangleSchema = z.object({
  x: pixel, y: pixel, width: pixel.positive(), height: pixel.positive(),
}).strict();
export const pointSchema = z.object({ x: pixel.nonnegative(), y: pixel.nonnegative() }).strict();
export const targetSchema = z.object({ windowId: idSchema }).strict();
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
export const observeSchema = targetSchema.extend({ maxNodes: z.number().int().min(1).max(256).default(128) }).strict();
export const typeSchema = elementSchema.extend({ text: z.string().max(4000) }).strict();
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
export const windowSchema = z.object({ windowId: idSchema, pid: pixel.positive(), title: z.string().max(2048), className: z.string().max(255), bounds: rectangleSchema }).strict();
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
