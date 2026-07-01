import { useEffect, useMemo, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ComposerAttachment } from '../composer/useComposerAttachments';
import type { ImagePreviewItem } from './types';

function samePreview(a: ImagePreviewItem | undefined, b: ImagePreviewItem): boolean {
  return (
    a?.name === b.name &&
    a.mediaType === b.mediaType &&
    a.base64 === b.base64 &&
    a.byteLength === b.byteLength
  );
}

export function useAttachmentImagePreviews(
  workspaceId: string,
  attachments: ReadonlyArray<ComposerAttachment>,
): ReadonlyMap<string, ImagePreviewItem> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, ImagePreviewItem>>(
    () => new Map(),
  );
  const attachmentKey = useMemo(
    () => attachments.map((att) => `${att.path}\u0000${att.name}`).join('\u0001'),
    [attachments],
  );

  useEffect(() => {
    let cancelled = false;
    const activePaths = new Set(attachments.map((att) => att.path));

    setPreviews((current) => {
      let changed = false;
      const next = new Map<string, ImagePreviewItem>();
      for (const [path, preview] of current) {
        if (activePaths.has(path)) next.set(path, preview);
        else changed = true;
      }
      return changed ? next : current;
    });

    for (const att of attachments) {
      void api()
        .invoke('session.previewAttachment', {
          workspaceId,
          path: att.path,
          name: att.name,
        })
        .then((preview) => {
          if (cancelled) return;
          setPreviews((current) => {
            if (preview?.kind === 'image' && samePreview(current.get(att.path), preview)) {
              return current;
            }
            if (preview?.kind !== 'image' && !current.has(att.path)) {
              return current;
            }
            const next = new Map(current);
            if (preview?.kind === 'image') next.set(att.path, preview);
            else next.delete(att.path);
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setPreviews((current) => {
            if (!current.has(att.path)) return current;
            const next = new Map(current);
            next.delete(att.path);
            return next;
          });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [workspaceId, attachmentKey, attachments]);

  return previews;
}
