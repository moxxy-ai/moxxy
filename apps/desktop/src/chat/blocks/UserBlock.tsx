import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { UserPromptAttachment } from '@moxxy/sdk';
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
      className="attachment-thumb"
      data-zoomable={onPreviewImage ? 'true' : undefined}
      onClick={() => onPreviewImage?.(image)}
    >
      <img src={imagePreviewSrc(image)} alt={image.name} />
    </button>
  );
}

function FileChip({ att }: { readonly att: UserPromptAttachment }): JSX.Element {
  const label = att.name ?? att.kind;
  const size = humanSize(payloadBytes(att));
  return (
    <span className="attachment-file" title={`${label} · ${size}`}>
      <Icon name="attach" size={12} />
      <span className="attachment-file__name">{label}</span>
      <span className="attachment-file__size">{size}</span>
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
  const [full, setFull] = useState(false);
  const lines = countLines(text);
  const long = lines > CLAMP_LINES;
  // A pasted prompt can be a 40-line preamble. Whole, it is the largest thing
  // on screen and buries the answer under it, so it opens clamped.
  const clamped = long && !full;
  return (
    <div className="user-turn" data-testid="block-user">
      {hasAttachments && (
        <div className="attachments">
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
        <div className="bubble bubble--user" data-clamped={clamped ? 'true' : undefined}>
          {text}
        </div>
      )}
      {long && (
        <button
          type="button"
          className="bubble-expand"
          data-testid="user-prompt-expand"
          onClick={() => setFull((f) => !f)}
        >
          {full ? 'Show less' : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  );
}

/** Lines a command shows before it clamps. Twelve is about the point where a
 *  prompt stops being something you read and starts being something you scroll
 *  past. */
const CLAMP_LINES = 12;

function countLines(text: string): number {
  let n = 1;
  for (const ch of text) if (ch === '\n') n++;
  return n;
}

