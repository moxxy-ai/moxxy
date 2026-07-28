import type { UserPromptAttachment } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';
import { imagePreviewSrc, type ImagePreviewItem } from '../image-preview/types';

/** Rough byte size of an attachment's payload, for the chip label. Base64
 *  (image/document) decodes to ~3/4 its length; inline text is its own length. */
function payloadBytes(att: UserPromptAttachment): number {
  if (att.kind === 'image' || att.kind === 'document') {
    return Math.floor((att.content.length * 3) / 4);
  }
  return att.content.length;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageThumb({
  att,
  onPreviewImage,
}: {
  readonly att: UserPromptAttachment;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element {
  const image = {
    name: att.name ?? 'attached image',
    mediaType: att.mediaType ?? 'image/png',
    base64: att.content,
  };
  return (
    <button
      type="button"
      aria-label={`Preview attached image ${image.name}`}
      title={image.name}
      onClick={() => onPreviewImage?.(image)}
      style={{
        padding: 0,
        background: 'transparent',
        border: 'none',
        borderRadius: 12,
        lineHeight: 0,
        cursor: onPreviewImage ? 'zoom-in' : 'default',
      }}
    >
      <img
        src={imagePreviewSrc(image)}
        alt={image.name}
        style={{
          maxWidth: 180,
          maxHeight: 180,
          borderRadius: 12,
          border: '1px solid var(--color-card-border)',
          objectFit: 'cover',
          boxShadow: '0 6px 18px -12px rgba(0,0,0,0.5)',
        }}
      />
    </button>
  );
}

function FileChip({ att }: { readonly att: UserPromptAttachment }): JSX.Element {
  const label = att.name ?? att.kind;
  return (
    <span
      title={`${label} · ${humanSize(payloadBytes(att))}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-primary)',
        borderRadius: 999,
        fontSize: 12,
        color: 'var(--color-primary-strong)',
        fontWeight: 600,
        maxWidth: 280,
      }}
    >
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
        {label}
      </span>
      <span style={{ opacity: 0.6, fontWeight: 500 }}>{humanSize(payloadBytes(att))}</span>
    </span>
  );
}

export function UserBlock({
  text,
  attachments,
  onPreviewImage,
}: {
  readonly text: string;
  readonly attachments?: ReadonlyArray<UserPromptAttachment>;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element {
  const items = attachments ?? [];
  const hasAttachments = items.length > 0;
  return (
    <div
      data-testid="block-user"
      style={{
        alignSelf: 'flex-end',
        maxWidth: '78%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
      }}
    >
      {hasAttachments && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            justifyContent: 'flex-end',
            alignItems: 'flex-end',
          }}
        >
          {items.map((att, i) =>
            att.kind === 'image' ? (
              <ImageThumb
                key={`${att.name ?? 'img'}-${i}`}
                att={att}
                onPreviewImage={onPreviewImage}
              />
            ) : (
              <FileChip key={`${att.name ?? att.kind}-${i}`} att={att} />
            ),
          )}
        </div>
      )}
      {(text.length > 0 || !hasAttachments) && (
        <div
          style={{
            // Just the text. The gradient bubble it replaces carried a solid
            // base, a gradient, white ink, a text-shadow and a drop shadow, all
            // to keep one short line readable against itself. Right alignment
            // already says whose turn this is, so none of that chrome was
            // paying for the noise it added.
            padding: '2px 0',
            color: 'var(--color-text)',
            fontWeight: 500,
            textAlign: 'right',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
            fontSize: 14.5,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
