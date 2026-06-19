import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createListenerSet } from './externalStore.js';
import { connectionStore } from './useConnection.js';

/**
 * The "send to chat" seam.
 *
 * A surface OUTSIDE the chat view (today: a desktop "app" like the document
 * anonymizer; tomorrow: a sandboxed app via the SDK `session.send` bridge
 * method) can hand a payload to the user's ACTIVE session without copy+paste.
 * The behaviour is REVIEW-IN-COMPOSER: the text is prefilled into that
 * session's composer and the chat view is shown, so the user reviews/edits it
 * and presses Send. Nothing reaches the model until the user sends — that
 * review step is the consent gate.
 *
 * This is a hand-rolled module store (mirrors {@link ./askStore}) backing
 * React's `useSyncExternalStore`: a per-workspace pending draft plus a transient
 * "show the chat view" pulse. The Composer drains the draft; the App shell
 * consumes the pulse to switch views.
 */

/** A payload an app hands to the active session. Enrichable: `text` is the body,
 *  `title` becomes a short leading context line, `meta` rides along for the
 *  future (not put into the prompt text today), and `submit` is reserved for a
 *  future auto-send (ignored — the behaviour is always review-in-composer). */
export interface SendToSessionPayload {
  readonly text: string;
  readonly title?: string;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
  /** Reserved: auto-submit instead of review-in-composer. Ignored today. */
  readonly submit?: boolean;
}

class ComposerDraftStore {
  /** workspaceId -> text waiting to be drained into that composer. */
  private drafts = new Map<string, string>();
  /** Transient "bring the chat view forward" request, consumed by the shell. */
  private wantChatView = false;
  private readonly listeners = createListenerSet();

  subscribe = this.listeners.subscribe;

  /** Stage `text` for `workspaceId`'s composer and ask the shell to show chat.
   *  Always emits — even for an identical re-send — because the consumer clears
   *  its snapshot on drain, so the next identical prefill is still observed. */
  prefill(workspaceId: string, text: string): void {
    this.drafts.set(workspaceId, text);
    this.wantChatView = true;
    this.listeners.emit();
  }

  /** Pending draft for a workspace, or null. PURE — safe as a
   *  `useSyncExternalStore` snapshot getter (returns a primitive). */
  peekDraft(workspaceId: string): string | null {
    return this.drafts.get(workspaceId) ?? null;
  }

  /** Drain a workspace's pending draft (returns it, then clears). Emits so the
   *  snapshot returns to null — idempotent: a second call returns null. */
  takeDraft(workspaceId: string): string | null {
    const text = this.drafts.get(workspaceId) ?? null;
    if (text == null) return null;
    this.drafts.delete(workspaceId);
    this.listeners.emit();
    return text;
  }

  /** Forget any pending draft for a removed workspace. Called from the
   *  session-removal flow so a draft staged for a session that is deleted
   *  before its composer drains it doesn't linger forever (and can't resurface
   *  if the id is ever reused). No-op when there's nothing staged. */
  dropWorkspace(workspaceId: string): void {
    if (!this.drafts.delete(workspaceId)) return;
    this.listeners.emit();
  }

  /** Whether a "show the chat view" request is pending. PURE snapshot getter. */
  peekChatViewRequest = (): boolean => this.wantChatView;

  /** Clear the "show the chat view" request after the shell has acted on it. */
  consumeChatViewRequest(): void {
    if (!this.wantChatView) return;
    this.wantChatView = false;
    this.listeners.emit();
  }
}

export const composerDraftStore = new ComposerDraftStore();

/** Fold a payload into the single string the user reviews in the composer.
 *  `title` becomes a leading line; `meta` is intentionally not serialised. */
function formatPayload(payload: SendToSessionPayload): string {
  const text = payload.text;
  const title = payload.title?.trim();
  return title ? `${title}\n\n${text}` : text;
}

/**
 * Hand a payload to the user's ACTIVE session (review-in-composer). Resolves the
 * active workspace from the connection store, prefills its composer, and pulses
 * a chat-view request. Returns `false` (a no-op) when there is no active
 * workspace yet — the caller can surface that, though in practice an app is only
 * reachable once a workspace is connected.
 */
export function sendToSession(payload: SendToSessionPayload): boolean {
  const workspaceId = connectionStore.active$();
  if (!workspaceId) return false;
  composerDraftStore.prefill(workspaceId, formatPayload(payload));
  return true;
}

/** The pending composer prefill for `workspaceId` (null when none). The Composer
 *  subscribes to this and drains it via {@link composerDraftStore.takeDraft}. */
export function usePendingComposerDraft(workspaceId: string | null): string | null {
  return useSyncExternalStore(composerDraftStore.subscribe, () =>
    workspaceId ? composerDraftStore.peekDraft(workspaceId) : null,
  );
}

/**
 * Run `onRequested` once whenever a "show the chat view" pulse arrives (e.g. the
 * user clicked an app's "Send to chat"). The shell wires this to its view-state
 * setter. `onRequested` is held in a ref so an inline callback doesn't re-fire
 * the effect every render.
 */
export function useComposerChatViewRequest(onRequested: () => void): void {
  const cb = useRef(onRequested);
  cb.current = onRequested;
  const requested = useSyncExternalStore(
    composerDraftStore.subscribe,
    composerDraftStore.peekChatViewRequest,
  );
  useEffect(() => {
    if (!requested) return;
    composerDraftStore.consumeChatViewRequest();
    cb.current();
  }, [requested]);
}
