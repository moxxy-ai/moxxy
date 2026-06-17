import { z } from 'zod';
import type { FileDiffDisplay, ViewDoc } from '@moxxy/sdk';

/**
 * Wire protocol between the web surface server and the browser. Plain JSON over
 * a WebSocket. Shared by the channel (Node) and the frontend (browser); keep it
 * DOM-free so esbuild can bundle it for the browser. (The frontend imports
 * ONLY types from this module, so the zod runtime never reaches the browser
 * bundle.)
 */

/** Server → browser. */
export type ServerFrame =
  | { readonly kind: 'hello'; readonly sessionId?: string }
  /** A new view to render; `replaces` swaps the prior view in place. */
  | {
      readonly kind: 'view';
      readonly viewId: string;
      readonly turnId: string;
      readonly replaces: string | null;
      /** Logical screen name (from `<view name>`), for client-side navigation/caching. */
      readonly name?: string;
      readonly doc: ViewDoc;
      readonly fallbackText?: string;
    }
  /** Lightweight turn status (thinking / running a tool / done / error). */
  | {
      readonly kind: 'status';
      readonly turnId: string;
      readonly phase: 'thinking' | 'tool' | 'done' | 'error';
      readonly text: string;
    }
  /** Assistant or user prose, mirrored into the transcript. */
  | { readonly kind: 'message'; readonly turnId: string; readonly role: 'assistant' | 'user'; readonly text: string }
  /** A structured file diff (from a Write/Edit tool result), rendered in the chat stream. */
  | { readonly kind: 'file-diff'; readonly turnId: string; readonly display: FileDiffDisplay }
  /** Acknowledge an inbound action. */
  | { readonly kind: 'ack'; readonly actionId: string; readonly accepted: boolean; readonly reason?: string };

/** Browser → server. */
export type ClientFrame =
  /** Free-text prompt typed into the surface's input box. */
  | { readonly kind: 'prompt'; readonly text: string }
  /** A form submission / button click from a rendered view. */
  | {
      readonly kind: 'action';
      readonly actionId: string;
      readonly viewId: string | null;
      readonly action: { readonly name: string; readonly params?: Record<string, unknown> };
      readonly formValues: Record<string, string>;
    };

/**
 * Runtime validator for browser → server frames. The WS endpoint is
 * internet-exposed via tunnels, so every inbound frame MUST be validated
 * before any field access — a cast after JSON.parse let `{"kind":"prompt"}`
 * throw inside the ws 'message' listener and take the whole process down.
 * Mirrors {@link ClientFrame}; the drift guard below keeps them in sync.
 */
export const clientFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), text: z.string() }),
  z.object({
    kind: z.literal('action'),
    actionId: z.string(),
    viewId: z.string().nullable(),
    action: z.object({ name: z.string(), params: z.record(z.unknown()).optional() }),
    formValues: z.record(z.string()),
  }),
]);

/** Compile-time drift guard: schema output and ClientFrame must stay mutually assignable. */
type AssertTrue<T extends true> = T;
export type _ClientFrameSchemaInSync = AssertTrue<
  z.infer<typeof clientFrameSchema> extends ClientFrame
    ? ClientFrame extends z.infer<typeof clientFrameSchema>
      ? true
      : false
    : false
>;

/**
 * Synthesize the user-turn prompt for a view action. The agent is taught (via
 * the build-view skill) to read `[ui-action]` blocks and respond by calling
 * present_view again. Kept here so the channel and any test share one format.
 */
export function actionPrompt(action: { name: string; params?: Record<string, unknown> }, formValues: Record<string, string>): string {
  const payload = JSON.stringify({ action: action.name, ...(action.params ? { params: action.params } : {}), values: formValues });
  return [
    '[ui-action] The user interacted with the presented view.',
    '```json',
    payload,
    '```',
  ].join('\n');
}
