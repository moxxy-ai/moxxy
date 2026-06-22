import { useEffect, useState } from 'react';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';

/** Decode a base64 attachment payload into a Blob object URL so the renderer
 *  holds a single off-DOM Blob instead of a multi-MB `data:` string baked into
 *  an attribute (re-parsed on every mount). Returns null until ready / on
 *  decode failure (caller falls back to nothing rather than a broken img). */
function useImageObjectUrl(content: string, mediaType: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    try {
      const binary = atob(content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
      if (!revoked) setUrl(objectUrl);
    } catch {
      setUrl(null);
    }
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [content, mediaType]);
  return url;
}

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

function ImageThumb({ att }: { readonly att: UserPromptAttachment }): JSX.Element | null {
  const src = useImageObjectUrl(att.content, att.mediaType ?? 'image/png');
  if (!src) return null;
  return (
    <img
      src={src}
      alt={att.name ?? 'attached image'}
      title={att.name}
      style={{
        maxWidth: 180,
        maxHeight: 180,
        borderRadius: 12,
        border: '1px solid var(--color-card-border)',
        objectFit: 'cover',
        boxShadow: '0 6px 18px -12px rgba(0,0,0,0.5)',
      }}
    />
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
}: {
  readonly text: string;
  readonly attachments?: ReadonlyArray<UserPromptAttachment>;
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
              <ImageThumb key={`${att.name ?? 'img'}-${i}`} att={att} />
            ) : (
              <FileChip key={`${att.name ?? att.kind}-${i}`} att={att} />
            ),
          )}
        </div>
      )}
      {(text.length > 0 || !hasAttachments) && (
        <div
          style={{
            padding: '12px 16px',
            // z.ai: a quiet neutral-grey bubble with dark text (not a brand
            // gradient). color-mix keeps it theme-aware (grey on white in light,
            // a step above the canvas in dark).
            background: 'color-mix(in srgb, var(--color-text) 7%, var(--color-main-bg))',
            color: 'var(--color-text)',
            borderRadius: '16px 16px 4px 16px',
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
