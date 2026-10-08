/**
 * What a drop on the chat carries, and the way it reaches the composer that
 * stages it. The chat column is the drop target and the composer owns the
 * staged files, so the drop travels as a window event, the way a file picked
 * in the rail does (`FILE_INSERT_EVENT`).
 */

export interface DroppedFiles {
  readonly files: ReadonlyArray<File>;
  /** Folders in the drop, by name: a folder cannot be attached, and the person is told so. */
  readonly folders: ReadonlyArray<string>;
}

export const FILES_DROP_EVENT = 'moxxy:drop-files';

/** True for a drag that brings files in from outside the window. */
export function carriesFiles(transfer: Pick<DataTransfer, 'types'> | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes('Files');
}

/** Read a drop while its event is still being handled: the transfer is empty afterwards. */
export function droppedFiles(transfer: DataTransfer): DroppedFiles {
  const files: File[] = [];
  const folders: string[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry !== null && entry.isDirectory) {
      folders.push(entry.name);
      continue;
    }
    const file = item.getAsFile();
    if (file !== null) files.push(file);
  }
  return { files, folders };
}

export function emitDroppedFiles(dropped: DroppedFiles): void {
  window.dispatchEvent(new CustomEvent<DroppedFiles>(FILES_DROP_EVENT, { detail: dropped }));
}
