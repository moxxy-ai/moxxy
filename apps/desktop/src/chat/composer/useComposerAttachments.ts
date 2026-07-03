/**
 * Composer attachment handling as a focused hook.
 *
 * Owns the list of files staged for the next send (de-duplicated by path) plus
 * every way one gets added: the rail's file-insert CustomEvent, the native file
 * picker (`session.pickAttachment`), and pasting/dropping an image blob (which
 * the main process persists to a temp file via `session.saveImageAttachment`).
 * A transient `attachError` surfaces when a pasted image can't be attached.
 *
 * Extracted verbatim from `Composer.tsx`; behavior is unchanged. The composer
 * passes a `focusInput` callback so the textarea regains focus after an attach
 * (it owns the textarea ref).
 */
import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { FILE_INSERT_EVENT, type FileInsertDetail } from '@/shell/WorkspaceFiles';

export interface ComposerAttachment {
  readonly path: string;
  readonly name: string;
}

export type ComposerPasteTarget = HTMLInputElement | HTMLTextAreaElement;

/** Read a Blob/File as base64 (no `data:` prefix) so image bytes can
 *  ride across IPC. FileReader streams large blobs without the
 *  binary-string pitfalls of `btoa(String.fromCharCode(...))`. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('unexpected FileReader result'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export interface ComposerAttachments {
  /** Files staged for the next send (each ships as a `kind: 'file'` attachment). */
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  /** Add a file (no-op if its path is already staged). */
  readonly addAttachment: (att: ComposerAttachment) => void;
  /** Remove a staged file by path. */
  readonly removeAttachment: (path: string) => void;
  /** Drop every staged file (called after a successful send). */
  readonly clearAttachments: () => void;
  /** Transient error shown when a pasted/dropped image can't be attached. */
  readonly attachError: string | null;
  /** Open the native file picker and stage the chosen file. */
  readonly onAttach: () => Promise<void>;
  /** Clipboard paste handler: grabs image blobs, falls through for text. */
  readonly onPaste: (e: ClipboardEvent<ComposerPasteTarget>) => void;
}

export function useComposerAttachments(focusInput: () => void): ComposerAttachments {
  /** Files the user picked from the rail or the native picker. Each
   *  one ships as a UserPromptAttachment with kind: 'file' + content:
   *  absolute path so the agent's read_file / cat tools find it. */
  const [attachments, setAttachments] = useState<ReadonlyArray<ComposerAttachment>>([]);
  /** Transient error surfaced under the composer when a pasted image
   *  can't be attached (too large / unreadable). */
  const [attachError, setAttachError] = useState<string | null>(null);

  const addAttachment = useCallback((att: ComposerAttachment): void => {
    setAttachments((cur) => (cur.some((a) => a.path === att.path) ? cur : [...cur, att]));
  }, []);
  const removeAttachment = useCallback((path: string): void => {
    setAttachments((cur) => cur.filter((a) => a.path !== path));
  }, []);
  const clearAttachments = useCallback((): void => {
    setAttachments([]);
  }, []);

  // The context rail's file tree fires a CustomEvent when the user
  // clicks a file. We treat it as an attachment, not text — the
  // absolute path is what the agent needs, the chip in the input
  // is what the user wants to see.
  useEffect(() => {
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<FileInsertDetail>).detail;
      if (!detail?.absPath) return;
      addAttachment({ path: detail.absPath, name: detail.name });
      window.setTimeout(() => focusInput(), 0);
    };
    window.addEventListener(FILE_INSERT_EVENT, handler);
    return () => window.removeEventListener(FILE_INSERT_EVENT, handler);
  }, [addAttachment, focusInput]);

  /** Persist a pasted/dropped image blob to a temp file via the main
   *  process, then add the returned path as a regular attachment so it
   *  rides the same send pipeline as picked files. */
  const attachImageFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        const dataBase64 = await fileToBase64(file);
        const att = await api().invoke('session.saveImageAttachment', {
          dataBase64,
          mediaType: file.type,
          ...(file.name ? { name: file.name } : {}),
        });
        addAttachment(att);
        focusInput();
      } catch (err) {
        setAttachError(toErrorMessage(err));
        window.setTimeout(() => setAttachError(null), 3000);
      }
    },
    [addAttachment, focusInput],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<ComposerPasteTarget>): void => {
      // Grab image blobs off the clipboard (screenshots, copied images).
      // If there are none, fall through to the browser's default paste so
      // text keeps working untouched.
      const images = Array.from(e.clipboardData.items).filter(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      );
      if (images.length === 0) return;
      e.preventDefault();
      for (const item of images) {
        const file = item.getAsFile();
        if (file) void attachImageFile(file);
      }
    },
    [attachImageFile],
  );

  const onAttach = useCallback(async () => {
    try {
      const path = await api().invoke('session.pickAttachment');
      if (!path) return;
      const name = path.split('/').pop() ?? path;
      addAttachment({ path, name });
      focusInput();
    } catch {
      /* noop — file picker errors are non-fatal */
    }
  }, [addAttachment, focusInput]);

  return {
    attachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    attachError,
    onAttach,
    onPaste,
  };
}
