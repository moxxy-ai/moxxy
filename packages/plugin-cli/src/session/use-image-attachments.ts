import { useRef } from 'react';
import type { UserPromptAttachment } from '@moxxy/sdk';
import {
  detectPastedImagePath,
  extractImagePlaceholders,
  loadImageAttachment,
} from '../image-attachments.js';
import { readClipboardImageSync } from '../clipboard-image.js';

export interface ImageAttachmentsHandle {
  /** Insert the detected image path into the buffer as `[Image #N]`. */
  registerImage: (detected: ReturnType<typeof detectPastedImagePath>) => string;
  /** Bracketed-paste transform: returns the text to insert. */
  handlePasteText: (pasted: string) => string;
  /**
   * Resolve `[Image #N]` placeholders in `text` to attachment payloads
   * and clear the per-prompt image map (so future submissions get fresh
   * placeholder numbering). Returns `{ error }` if the active model can't
   * accept images.
   */
  resolveAttachments: (
    text: string,
    activeDescriptor: { supportsImages?: boolean } | null,
    providerName: string,
    activeModel: string,
  ) => Promise<UserPromptAttachment[] | { error: string }>;
}

/**
 * Pending images keyed by the integer in `[Image #N]` placeholders.
 * Promise<UserPromptAttachment | null>: null means the read failed,
 * which we surface as a notice but keep the placeholder text visible
 * so the user can see what went wrong. Cleared after a successful
 * submit so subsequent turns get fresh numbering.
 */
export function useImageAttachments(
  onError: (msg: string) => void,
): ImageAttachmentsHandle {
  const imageAttachmentsRef = useRef<Map<number, Promise<UserPromptAttachment | null>>>(new Map());
  const nextImageIdRef = useRef(1);

  const registerImage = (detected: ReturnType<typeof detectPastedImagePath>): string => {
    if (!detected) return '';
    const id = nextImageIdRef.current;
    nextImageIdRef.current += 1;
    imageAttachmentsRef.current.set(
      id,
      loadImageAttachment(detected).catch((err) => {
        onError(
          `failed to read image ${detected.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }),
    );
    return `[Image #${id}]`;
  };

  const handlePasteText = (pasted: string): string => {
    // Path 1: pasted text itself is a file path to an image (drag-drop
    // from Finder, "Copy as Path", or `pbcopy <path>`).
    const pathDetected = detectPastedImagePath(pasted);
    if (pathDetected) return registerImage(pathDetected);

    // Path 2: terminals fire bracketed paste with empty / whitespace
    // content when the clipboard holds an image (e.g. a screenshot
    // copied via Cmd+Shift+Ctrl+4). Probe the system clipboard for an
    // image and route it through the same pipeline. Falls back to the
    // raw paste if the clipboard has no image (or the platform isn't
    // supported), so plain text pastes are unaffected.
    if (pasted.trim() === '') {
      const fromClipboard = readClipboardImageSync();
      if (fromClipboard) return registerImage(fromClipboard);
    }
    return pasted;
  };

  const resetPending = (): void => {
    imageAttachmentsRef.current.clear();
    nextImageIdRef.current = 1;
  };

  const resolveAttachments = async (
    text: string,
    activeDescriptor: { supportsImages?: boolean } | null,
    providerName: string,
    activeModel: string,
  ): Promise<UserPromptAttachment[] | { error: string }> => {
    const referencedIds = extractImagePlaceholders(text);
    // Clear the per-prompt map up front so a submit that references NO
    // placeholders (e.g. the user pasted an image then deleted the
    // `[Image #N]` text, or sent a slash command) still releases any
    // eagerly-decoded base64 buffers instead of retaining them for the whole
    // session and letting nextImageIdRef climb forever.
    if (referencedIds.length === 0) {
      resetPending();
      return [];
    }
    if (activeDescriptor && activeDescriptor.supportsImages !== true) {
      // Keep the pending map intact: the user can switch to a vision model
      // via /model and resubmit the same placeholders without re-pasting.
      return {
        error: `${providerName}:${activeModel} doesn't accept images — switch to a vision-capable model via /model`,
      };
    }
    const attachments: UserPromptAttachment[] = [];
    for (const id of referencedIds) {
      const pending = imageAttachmentsRef.current.get(id);
      if (!pending) continue;
      const att = await pending;
      if (att) attachments.push(att);
    }
    resetPending();
    return attachments;
  };

  return { registerImage, handlePasteText, resolveAttachments };
}
