import type { ContentBlock } from './provider.js';
import { isToolDisplayResult } from './tool-display.js';

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
  const image = imageBlockFromOutput(output);
  if (image) {
    const description = (output as { forModel?: unknown }).forModel;
    return { text: typeof description === 'string' ? description : IMAGE_MARKER, image };
  }
  return { text: safeStringifyOutput(output), image: null };
}

/**
 * A tool can return `{ mediaType, base64 }` (the desktop screenshot/clipboard
 * shape) or the provider-native `{ type:'image', mediaType, data }`; both are
 * handed over as an image block so the model SEES the pixels.
 */
function imageBlockFromOutput(output: unknown): ToolImageBlock | null {
  if (typeof output !== 'object' || output === null) return null;
  const o = output as { type?: unknown; mediaType?: unknown; base64?: unknown; data?: unknown };
  if (typeof o.mediaType !== 'string') return null;
  const data =
    typeof o.base64 === 'string'
      ? o.base64
      : o.type === 'image' && typeof o.data === 'string'
        ? o.data
        : null;
  if (data === null) return null;
  return { type: 'image', mediaType: o.mediaType, data };
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
