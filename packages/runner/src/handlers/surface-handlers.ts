import {
  surfaceOpenParamsSchema,
  surfaceInputParamsSchema,
  surfaceResizeParamsSchema,
  surfaceCloseParamsSchema,
} from '../protocol.js';
import type { HandlerContext } from './context.js';

// Surfaces (v8; delegate to the session's SurfaceHost). Output streams back as
// `surface.data` notifications (subscribed in the server ctor). All degrade
// cleanly when no surface plugin is loaded: list → [], open → throws a clear
// "no surface" error.

export async function handleSurfaceList(ctx: HandlerContext): Promise<unknown[]> {
  return [...(await ctx.session.surfaces.list())];
}

export async function handleSurfaceOpen(ctx: HandlerContext, raw: unknown): Promise<unknown> {
  const { kind } = surfaceOpenParamsSchema.parse(raw);
  return ctx.session.surfaces.open(kind);
}

export async function handleSurfaceInput(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { surfaceId, message } = surfaceInputParamsSchema.parse(raw);
  await ctx.session.surfaces.input(surfaceId, message);
  return {};
}

export async function handleSurfaceResize(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { surfaceId, size } = surfaceResizeParamsSchema.parse(raw);
  await ctx.session.surfaces.resize(surfaceId, size);
  return {};
}

export async function handleSurfaceClose(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { surfaceId } = surfaceCloseParamsSchema.parse(raw);
  await ctx.session.surfaces.close(surfaceId);
  return {};
}
