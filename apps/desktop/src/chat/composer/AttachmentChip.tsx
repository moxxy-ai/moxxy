import { Icon } from '@moxxy/desktop-ui';
import { imagePreviewSrc, type ImagePreviewItem } from '../image-preview/types';

/**
 * Pill rendered above the textarea for each attached file. Shows the
 * basename and a tiny × to drop it. The full absolute path lives on
 * the title= attr so a hover reveals where on disk the agent will
 * read it from.
 */
export function AttachmentChip({
  name,
  path,
  preview,
  onPreview,
  onRemove,
}: {
  readonly name: string;
  readonly path: string;
  readonly preview?: ImagePreviewItem;
  readonly onPreview?: (image: ImagePreviewItem) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const previewButton =
    preview && onPreview ? (
      <button
        type="button"
        aria-label={`Preview ${name}`}
        onClick={() => onPreview(preview)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          padding: 0,
          color: 'inherit',
          background: 'transparent',
          border: 'none',
          font: 'inherit',
        }}
      >
        <img
          src={imagePreviewSrc(preview)}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            objectFit: 'cover',
            border: '1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)',
            flex: '0 0 auto',
          }}
        />
        <span
          className="mono"
          style={{
            maxWidth: 200,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          @{name}
        </span>
      </button>
    ) : null;

  return (
    <span
      title={path}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 4px 4px 10px',
        background: 'var(--color-primary-soft)',
        border: '1px solid var(--color-primary)',
        borderRadius: 999,
        fontSize: 12,
        color: 'var(--color-primary-strong)',
        fontWeight: 600,
        maxWidth: 280,
      }}
    >
      {previewButton ?? (
        <>
          <Icon name="attach" size={12} />
          <span
            className="mono"
            style={{
              maxWidth: 200,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            @{name}
          </span>
        </>
      )}
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'color-mix(in srgb, var(--color-primary) 18%, transparent)',
          color: 'var(--color-primary-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="x" size={11} />
      </button>
    </span>
  );
}
