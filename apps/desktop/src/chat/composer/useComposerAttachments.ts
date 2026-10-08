/**
 * Composer attachment handling as a focused hook.
 *
 * Owns the list of files staged for the next send (de-duplicated by path) plus
 * every way one gets added: a file picked in the rail, the native file picker,
 * and a file dropped on the chat or pasted into the field. A file named by its
 * path is asked of the host first (`session.checkAttachment`); a file that
 * arrives as bytes is sized here and then written to a temp file by the host.
 * Either it is staged or `attachError` says why not: nothing is left to be
 * dropped silently when the prompt is sent.
 *
 * The composer passes a `focusInput` callback so the textarea regains focus
 * after an attach (it owns the textarea ref).
 */
import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { attachmentSizeProblem, isImageFileName } from '@moxxy/desktop-ipc-contract';
import { FILE_INSERT_EVENT, type FileInsertDetail } from '@/shell/WorkspaceFiles';
import { FILES_DROP_EVENT, type DroppedFiles } from './dropped-files';

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

/** The image types the host stores as an image the model can see. */
const STORED_AS_IMAGE = /^image\/(?:png|jpeg|gif|webp|bmp)$/u;

export interface ComposerAttachments {
  /** Files staged for the next send (each ships as a `kind: 'file'` attachment). */
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  /** Add a file (no-op if its path is already staged). */
  readonly addAttachment: (att: ComposerAttachment) => void;
  /** Remove a staged file by path. */
  readonly removeAttachment: (path: string) => void;
  /** Drop every staged file (called after a successful send). */
  readonly clearAttachments: () => void;
  /** Why the last files could not be attached. Stays until it is dismissed or files are added again. */
  readonly attachError: string | null;
  readonly dismissAttachError: () => void;
  /** Open the native file picker and stage the chosen file. */
  readonly onAttach: () => Promise<void>;
  /** Clipboard paste handler: stages files, falls through for text. */
  readonly onPaste: (e: ClipboardEvent<ComposerPasteTarget>) => void;
}

export function useComposerAttachments(focusInput: () => void): ComposerAttachments {
  /** Each one ships as a UserPromptAttachment with kind: 'file' + content:
   *  absolute path so the agent's read_file / cat tools find it. */
  const [attachments, setAttachments] = useState<ReadonlyArray<ComposerAttachment>>([]);
  const [problems, setProblems] = useState<ReadonlyArray<string>>([]);

  const addAttachment = useCallback((att: ComposerAttachment): void => {
    setAttachments((cur) => (cur.some((a) => a.path === att.path) ? cur : [...cur, att]));
  }, []);
  const removeAttachment = useCallback((path: string): void => {
    setAttachments((cur) => cur.filter((a) => a.path !== path));
  }, []);
  const clearAttachments = useCallback((): void => {
    setAttachments([]);
    // The prompt has gone: what was said about its files is said.
    setProblems([]);
  }, []);
  const dismissAttachError = useCallback((): void => setProblems([]), []);
  const refuse = useCallback((problem: string): void => setProblems((cur) => [...cur, problem]), []);

  /** A file already on disk: the host says whether a prompt would go out with it. */
  const stagePath = useCallback(
    async (att: ComposerAttachment): Promise<void> => {
      setProblems([]);
      // A host that cannot answer is not a reason to refuse the file.
      const problem = await api()
        .invoke('session.checkAttachment', { path: att.path, name: att.name })
        .catch(() => null);
      if (typeof problem === 'string') {
        refuse(problem);
        return;
      }
      addAttachment(att);
      focusInput();
    },
    [addAttachment, focusInput, refuse],
  );

  /** Files that arrive as bytes: sized before they are read, then written to a
   *  temp file by the host so they ride the same send pipeline as a picked one. */
  const stageFiles = useCallback(
    async (files: ReadonlyArray<File>): Promise<void> => {
      for (const file of files) {
        const image = STORED_AS_IMAGE.test(file.type);
        const problem = attachmentSizeProblem({
          name: file.name,
          size: file.size,
          image: image || isImageFileName(file.name),
        });
        if (problem) {
          refuse(problem);
          continue;
        }
        try {
          const dataBase64 = await fileToBase64(file);
          const att = image
            ? await api().invoke('session.saveImageAttachment', {
                dataBase64,
                mediaType: file.type,
                ...(file.name ? { name: file.name } : {}),
              })
            : await api().invoke('session.saveAttachment', { dataBase64, name: file.name });
          addAttachment(att);
          focusInput();
        } catch (err) {
          refuse(toErrorMessage(err));
        }
      }
    },
    [addAttachment, focusInput, refuse],
  );

  // The context rail's file tree fires a CustomEvent when the user
  // clicks a file. We treat it as an attachment, not text — the
  // absolute path is what the agent needs, the chip in the input
  // is what the user wants to see.
  useEffect(() => {
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<FileInsertDetail>).detail;
      if (!detail?.absPath) return;
      void stagePath({ path: detail.absPath, name: detail.name });
    };
    window.addEventListener(FILE_INSERT_EVENT, handler);
    return () => window.removeEventListener(FILE_INSERT_EVENT, handler);
  }, [stagePath]);

  useEffect(() => {
    const handler = (ev: Event): void => {
      const { files, folders } = (ev as CustomEvent<DroppedFiles>).detail;
      setProblems(folders.map((name) => `${name} is a folder. Attach the files inside it.`));
      void stageFiles(files);
    };
    window.addEventListener(FILES_DROP_EVENT, handler);
    return () => window.removeEventListener(FILES_DROP_EVENT, handler);
  }, [stageFiles]);

  const onPaste = useCallback(
    (e: ClipboardEvent<ComposerPasteTarget>): void => {
      // Files off the clipboard: a screenshot, a copied image, a file copied
      // in the file manager. With none, the default paste goes ahead so text
      // keeps working untouched.
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length === 0) return;
      e.preventDefault();
      setProblems([]);
      void stageFiles(files);
    },
    [stageFiles],
  );

  const onAttach = useCallback(async () => {
    try {
      const path = await api().invoke('session.pickAttachment');
      if (!path) return;
      // Either separator: the picker answers with the platform's own.
      const name = path.split(/[\\/]/u).pop() ?? path;
      await stagePath({ path, name });
    } catch {
      /* noop — file picker errors are non-fatal */
    }
  }, [stagePath]);

  return {
    attachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    attachError: problems.length > 0 ? problems.join(' ') : null,
    dismissAttachError,
    onAttach,
    onPaste,
  };
}
