import type { ToolImage as ToolImageData } from '@moxxy/sdk/tool-display';
import { useOpenImagePreview } from '../image-preview/ImagePreviewContext';
import { imagePreviewSrc } from '../image-preview/types';

/** The image a tool returned, as a thumbnail like an attached image; clicking opens the preview. */
export function ToolImage({ image, tool }: { readonly image: ToolImageData; readonly tool: string }): JSX.Element {
  const open = useOpenImagePreview();
  const item = { name: tool, mediaType: image.mediaType, base64: image.base64 };
  return (
    <div className="tool-image">
      <button
        type="button"
        aria-label={`Preview the image ${tool} returned`}
        title={tool}
        className="attachment-thumb"
        data-zoomable={open ? 'true' : undefined}
        onClick={() => open?.(item)}
      >
        <img src={imagePreviewSrc(item)} alt={`Image ${tool} returned`} />
      </button>
    </div>
  );
}
