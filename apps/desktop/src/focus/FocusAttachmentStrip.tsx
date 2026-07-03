import type { ComposerAttachment } from '@/chat/composer/useComposerAttachments';
import { imagePreviewSrc, type ImagePreviewItem } from '@/chat/image-preview/types';
import { XIcon } from './focus-icons';
import { style } from './focus-styles';

export function FocusAttachmentStrip({
  attachments,
  previews,
  onPreview,
  onRemove,
}: {
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  readonly previews: ReadonlyMap<string, ImagePreviewItem>;
  readonly onPreview: (image: ImagePreviewItem) => void;
  readonly onRemove: (path: string) => void;
}): JSX.Element | null {
  if (attachments.length === 0) return null;

  return (
    <div style={style.focusAttachmentStrip}>
      {attachments.map((attachment) => {
        const preview = previews.get(attachment.path);
        return (
          <div key={attachment.path} style={style.focusAttachmentChip}>
            {preview ? (
              <button
                type="button"
                aria-label={`Preview ${attachment.name}`}
                title={attachment.name}
                onClick={() => onPreview(preview)}
                style={style.focusAttachmentPreview}
              >
                <img
                  src={imagePreviewSrc(preview)}
                  alt=""
                  draggable={false}
                  style={style.focusAttachmentThumb}
                />
                <span style={style.focusAttachmentName}>{attachment.name}</span>
              </button>
            ) : (
              <div title={attachment.name} style={style.focusAttachmentPending}>
                <span style={style.focusAttachmentPendingDot} aria-hidden />
                <span style={style.focusAttachmentName}>{attachment.name}</span>
              </div>
            )}
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              title={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.path)}
              style={style.focusAttachmentRemove}
            >
              <XIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
