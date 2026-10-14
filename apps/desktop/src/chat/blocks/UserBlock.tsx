import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { attachmentBytes } from '@moxxy/sdk/attachment-payload';
import { useAttachmentContent } from '../attachments/useAttachmentContent';
import { imagePreviewSrc, type ImagePreviewItem } from '../image-preview/types';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageThumb({
  att,
  seq,
  index,
  onPreviewImage,
}: {
  readonly att: UserPromptAttachment;
  readonly seq?: number;
  readonly index: number;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element {
  // A large image reaches the window without its bytes; until they are read
  // back (or if they cannot be), it shows as a labelled chip.
  const base64 = useAttachmentContent(att, seq, index);
  if (base64 === null) return <FileChip att={att} />;
  const image = {
    name: att.name ?? 'attached image',
    mediaType: att.mediaType ?? 'image/png',
    base64,
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
  const size = humanSize(attachmentBytes(att));
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
  seq,
  attachments,
  onPreviewImage,
}: {
  readonly text: string;
  /** The prompt event's seq, so a left-out attachment can be read back. */
  readonly seq?: number;
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
                seq={seq}
                index={i}
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

