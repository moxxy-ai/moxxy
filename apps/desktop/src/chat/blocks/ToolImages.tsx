import type { ToolImage } from '@moxxy/sdk/tool-display';
import { useOpenImagePreview } from '../image-preview/ImagePreviewContext';
import { imagePreviewSrc } from '../image-preview/types';

/** The images a tool returned, as thumbnails like attached images; clicking one opens it in the preview. */
export function ToolImages({ images, tool }: { readonly images: ReadonlyArray<ToolImage>; readonly tool: string }): JSX.Element {
  const open = useOpenImagePreview();
  return (
    <div className="tool-images">
      {images.map((image, index) => {
        const item = { name: tool, mediaType: image.mediaType, base64: image.base64 };
        const which = images.length === 1 ? 'the image' : `image ${index + 1} of ${images.length}`;
        return (
          <button
            key={index}
            type="button"
            aria-label={`Preview ${which} ${tool} returned`}
            title={tool}
            className="attachment-thumb"
            data-zoomable={open ? 'true' : undefined}
            onClick={() => open?.(item)}
          >
            <img src={imagePreviewSrc(item)} alt={`Image ${tool} returned`} />
          </button>
        );
      })}
    </div>
  );
}
