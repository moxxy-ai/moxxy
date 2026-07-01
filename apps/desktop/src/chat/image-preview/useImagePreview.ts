import { useCallback, useState } from 'react';
import type { ImagePreviewItem } from './types';

export function useImagePreview(): {
  readonly image: ImagePreviewItem | null;
  readonly open: (image: ImagePreviewItem) => void;
  readonly close: () => void;
} {
  const [image, setImage] = useState<ImagePreviewItem | null>(null);
  const open = useCallback((next: ImagePreviewItem) => setImage(next), []);
  const close = useCallback(() => setImage(null), []);
  return { image, open, close };
}
