import type { ContentBlock } from './provider.js';
import { isToolDisplayResult, toolImagesOf } from './tool-display.js';

export type ToolImageBlock = Extract<ContentBlock, { type: 'image' }>;

/** What a model is shown of a successful tool output: text, plus the pixels of each image. */
export interface ToolOutputForModel {
  readonly text: string;
  readonly images: ReadonlyArray<ToolImageBlock>;
}

const IMAGE_MARKER = '[image returned by tool — see attached image]';

/**
 * The one reading of a tool output for a model, shared by the projection and
 * by agent connections (which hand Moxxy tool results to a vendor agent).
 */
export function toolOutputForModel(output: unknown): ToolOutputForModel {
  // A rich result (e.g. a file diff): the model only needs the short summary.
  if (isToolDisplayResult(output)) return { text: output.forModel, images: [] };
  // Images are handed over as image blocks so the model SEES the pixels.
  const found = toolImagesOf(output);
  if (found) {
    const images = found.images.map((image): ToolImageBlock => ({ type: 'image', mediaType: image.mediaType, data: image.base64 }));
    return { text: found.text || IMAGE_MARKER, images };
  }
  return { text: safeStringifyOutput(output), images: [] };
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
