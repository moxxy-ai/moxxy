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
      // A sharp chip on a seam, not a full pill outlined in the accent. The
      // accent means "the human commanded this"; an attachment is a detail OF
      // the command, and a 999px radius is the one geometry this language does
      // not use outside a state LED.
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-6)',
        padding: '2px var(--space-6)',
        background: 'var(--color-input-soft)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-chip)',
        fontSize: 'var(--type-meta)',
        color: 'var(--color-text-muted)',
        maxWidth: 320,
      }}
    >
      <Icon name="attach" size={12} style={{ flexShrink: 0 }} />
      <span
        style={{
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {/* Never wraps: the size wrapping onto a second line was what made the
          chip twice as tall as the text inside it. */}
      <span style={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--color-text-dim)' }}>
        {humanSize(payloadBytes(att))}
      </span>
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
  // A pasted prompt can be a 40-line system preamble. Rendered whole it becomes
  // a wall of the commanded wash that buries the agent's actual work below it —
  // and the accent is supposed to be the thing your eye goes TO, not the largest
  // object on screen. Long turns clamp to a readable opening and expand on ask.
  const clamped = !full && countLines(text) > CLAMP_LINES;
  // No avatar and no name row: the trace's gutter glyph already says this entry
  // is a command, and a repeated 34px portrait was the widest thing on the left
  // edge while carrying no information the glyph does not.
  return (
    <div data-testid="block-user">
      <div style={{ minWidth: 0 }}>
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
              padding: 'var(--space-8) var(--space-12)',
              borderLeft: '2px solid var(--color-primary)',
              borderRadius: '0 var(--radius-block) var(--radius-block) 0',
              background: 'color-mix(in srgb, var(--color-primary-soft) 55%, transparent)',
              color: 'var(--color-text)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.55,
              fontSize: 'var(--type-row)',
              // A command is machine input, so it keeps the chrome face — and a
              // measure, so a long one reads as a column rather than the page.
              maxWidth: '78ch',
              overflow: 'hidden',
              display: clamped ? '-webkit-box' : undefined,
              WebkitBoxOrient: clamped ? 'vertical' : undefined,
              WebkitLineClamp: clamped ? CLAMP_LINES : undefined,
            }}
          >
            {text}
          </div>
        )}
        {(clamped || full) && countLines(text) > CLAMP_LINES && (
          <button
            type="button"
            data-testid="user-prompt-expand"
            onClick={() => setFull((f) => !f)}
            className="btn-ghost"
            style={{
              marginTop: 4,
              padding: '2px 6px',
              borderRadius: 'var(--radius-chip)',
              fontSize: 'var(--type-label)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-dim)',
            }}
          >
            {full ? 'Show less' : `Show all ${countLines(text)} lines`}
          </button>
        )}
      </div>
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

