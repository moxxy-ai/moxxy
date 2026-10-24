import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, readChatMediaImage, toErrorMessage, useChatMedia } from '@moxxy/client-core';
import type { ChatMediaItem } from '@moxxy/desktop-ipc-contract';
import type { ImagePreviewItem } from '../../../chat/image-preview/types';
import {
  filterMedia,
  groupByMonth,
  type MediaKind,
  type MediaOwnerFilter,
  type MonthGroup,
} from './media-library';

export interface MediaPreview {
  /** Null while the whole image is read. */
  readonly image: ImagePreviewItem | null;
  /** "2 of 90" on the shelf as filtered. */
  readonly position: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly previous: () => void;
  readonly next: () => void;
  readonly close: () => void;
}

export interface MediaPaneState {
  readonly kind: MediaKind;
  readonly setKind: (kind: MediaKind) => void;
  readonly owner: MediaOwnerFilter;
  readonly setOwner: (owner: MediaOwnerFilter) => void;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly loading: boolean;
  readonly error: string | null;
  /** The chat has nothing in its library at all (not just on this shelf). */
  readonly empty: boolean;
  /** The shelf as filtered, newest first. */
  readonly items: ReadonlyArray<ChatMediaItem>;
  /** The same items under their months (the image grid's sections). */
  readonly groups: ReadonlyArray<MonthGroup<ChatMediaItem>>;
  readonly preview: MediaPreview | null;
  readonly openImage: (id: string) => void;
  readonly openFile: (id: string) => Promise<void>;
  /** Why the last open failed, until the next one. */
  readonly notice: string | null;
}

/**
 * The media pane's state: which shelf, whose items, the words searched for, and
 * the image open in the preview. The library itself is `useChatMedia`'s; the
 * pane only draws what this returns.
 */
export function useMediaPane(workspaceId: string | null): MediaPaneState {
  const library = useChatMedia(workspaceId);
  const [kind, setKind] = useState<MediaKind>('image');
  const [owner, setOwner] = useState<MediaOwnerFilter>('all');
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    readonly id: string;
    readonly image: ImagePreviewItem;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shownChat = useRef(workspaceId);

  // Another chat is another library: start it from the top.
  if (shownChat.current !== workspaceId) {
    shownChat.current = workspaceId;
    setKind('image');
    setOwner('all');
    setQuery('');
    setPreviewId(null);
    setNotice(null);
  }

  const items = useMemo(
    () => filterMedia(library.items, { kind, owner, query }),
    [library.items, kind, owner, query],
  );
  const groups = useMemo(() => groupByMonth(items, new Date()), [items]);
  const images = useMemo(
    () => filterMedia(library.items, { kind: 'image', owner, query }),
    [library.items, owner, query],
  );
  // Read by the preview for the image's name only: reading the image again
  // whenever the shelf changes would flash the preview.
  const imagesNow = useRef(images);
  imagesNow.current = images;

  useEffect(() => {
    if (!workspaceId || previewId === null) return undefined;
    let live = true;
    const item = imagesNow.current.find((candidate) => candidate.id === previewId);
    readChatMediaImage(workspaceId, previewId).then(
      (whole) => {
        if (!live) return;
        if (!whole) {
          setNotice('This image is no longer in the chat.');
          setPreviewId(null);
          return;
        }
        const name = item?.kind === 'image' ? (item.name ?? 'Image') : 'Image';
        setPreviewImage({ id: previewId, image: { name, mediaType: whole.mediaType, base64: whole.base64 } });
      },
      (e: unknown) => {
        if (!live) return;
        setNotice(toErrorMessage(e));
        setPreviewId(null);
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId, previewId]);

  const openImage = useCallback((id: string) => {
    setNotice(null);
    setPreviewId(id);
  }, []);

  const openFile = useCallback(
    async (id: string) => {
      if (!workspaceId) return;
      setNotice(null);
      try {
        await api().invoke('chat.openMediaFile', { workspaceId, id });
      } catch (e) {
        setNotice(toErrorMessage(e));
      }
    },
    [workspaceId],
  );

  const preview = useMemo((): MediaPreview | null => {
    if (previewId === null) return null;
    const index = images.findIndex((item) => item.id === previewId);
    const step = (by: number) => () => {
      const target = images[index + by];
      if (target) setPreviewId(target.id);
    };
    return {
      image: previewImage?.id === previewId ? previewImage.image : null,
      position: index >= 0 ? `${index + 1} of ${images.length}` : '',
      hasPrevious: index > 0,
      hasNext: index >= 0 && index < images.length - 1,
      previous: step(-1),
      next: step(1),
      close: () => setPreviewId(null),
    };
  }, [previewId, previewImage, images]);

  return {
    kind,
    setKind,
    owner,
    setOwner,
    query,
    setQuery,
    loading: library.loading,
    error: library.error,
    empty: !library.loading && library.items.length === 0,
    items,
    groups,
    preview,
    openImage,
    openFile,
    notice,
  };
}
