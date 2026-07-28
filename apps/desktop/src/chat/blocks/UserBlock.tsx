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
      style={{ alignSelf: 'stretch', display: 'flex', gap: 12, maxWidth: '92%' }}
    >
      <Avatar />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>You</span>
        {hasAttachments && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
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
              // Right alignment says whose turn it is only while the turn is
              // short. A pasted prompt wraps to a ragged-left column the eye
              // has to re-find on every line, so the turn reads left-to-right
              // like every other block and the accent rule carries the "who".
              marginTop: 6,
              padding: '10px 14px',
              borderLeft: '2px solid var(--color-primary)',
              borderRadius: '3px 12px 12px 3px',
              background: 'color-mix(in srgb, var(--color-primary-soft) 55%, transparent)',
              color: 'var(--color-text)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.55,
              fontSize: 14.5,
            }}
          >
            {text}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar(): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        background: 'var(--color-primary)',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon name="user" size={18} />
    </span>
  );
}
