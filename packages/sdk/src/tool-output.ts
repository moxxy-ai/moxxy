import type { ContentBlock } from './provider.js';
import { isToolDisplayResult, toolImageOf } from './tool-display.js';

export type ToolImageBlock = Extract<ContentBlock, { type: 'image' }>;

/** What a model is shown of a successful tool output: text, plus the pixels of an image. */
export interface ToolOutputForModel {
  readonly text: string;
  readonly image: ToolImageBlock | null;
}

const IMAGE_MARKER = '[image returned by tool — see attached image]';

/**
 * The one reading of a tool output for a model, shared by the projection and
 * by agent connections (which hand Moxxy tool results to a vendor agent).
 */
export function toolOutputForModel(output: unknown): ToolOutputForModel {
  // A rich result (e.g. a file diff): the model only needs the short summary.
  if (isToolDisplayResult(output)) return { text: output.forModel, image: null };
  // An image is handed over as an image block so the model SEES the pixels.
  const found = toolImageOf(output);
  if (found) return { text: found.text || IMAGE_MARKER, image: { type: 'image', mediaType: found.image.mediaType, data: found.image.base64 } };
  return { text: safeStringifyOutput(output), image: null };
}

/**
 * `output` comes straight from whatever a tool returned, so it can be circular
 * or hold a BigInt, which makes `JSON.stringify` throw. Projection runs on every
 * request over the append-only log, so a throw here would wedge the session.
 */
function safeStringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output ?? '');
  } catch {
    try {
      return String(output ?? '');
    } catch {
      return '[unserializable tool output]';
    }
  }
}
