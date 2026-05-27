import type { ViewDoc } from '@moxxy/sdk';

/**
 * Wire protocol between the web surface server and the browser. Plain JSON over
 * a WebSocket. Shared by the channel (Node) and the frontend (browser); keep it
 * DOM-free and dependency-free so esbuild can bundle it for the browser.
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
