import { createContext, useContext } from 'react';
import type { ImagePreviewItem } from './types';

/**
 * Opens an image in the conversation's preview. A context because tool rows sit
 * deep inside groups the transcript draws, and the attachment path already
 * hands the same opener down as a prop.
 */
const ImagePreviewContext = createContext<((image: ImagePreviewItem) => void) | null>(null);

export const ImagePreviewProvider = ImagePreviewContext.Provider;

/** The preview opener, or `null` where nothing previews (the image then shows without zoom). */
export function useOpenImagePreview(): ((image: ImagePreviewItem) => void) | null {
  return useContext(ImagePreviewContext);
}
