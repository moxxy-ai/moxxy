import { useCallback, useRef, useState, type DragEvent } from 'react';
import { carriesFiles, droppedFiles, emitDroppedFiles } from './composer/dropped-files';

export interface FileDropZone {
  /** Files are being held over the zone. */
  readonly over: boolean;
  /** Spread onto the element that takes the drop. */
  readonly zone: {
    readonly onDragEnter: (event: DragEvent) => void;
    readonly onDragOver: (event: DragEvent) => void;
    readonly onDragLeave: (event: DragEvent) => void;
    readonly onDrop: (event: DragEvent) => void;
  };
}

/**
 * Makes an element a place to drop files for the composer. Only a drag that
 * brings files in from outside is claimed: dragged text still reaches the
 * field under it.
 */
export function useFileDropZone(): FileDropZone {
  const [over, setOver] = useState(false);
  // Entering a child fires before leaving its parent, so the drag is over the
  // zone for as long as it has entered more elements than it has left.
  const depth = useRef(0);

  const onDragEnter = useCallback((event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth.current += 1;
    setOver(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without this the drop is refused, and the window tries to open the file.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }, []);

  const onDrop = useCallback((event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    emitDroppedFiles(droppedFiles(event.dataTransfer));
  }, []);

  return { over, zone: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
