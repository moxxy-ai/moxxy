import { useEffect, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { Button, Icon } from '@moxxy/desktop-ui';
import { DiffView } from './DiffView';

export type FileViewMode = 'diff' | 'content';

type Body =
  | { readonly diff: string }
  | { readonly kind: 'text'; readonly content: string; readonly truncated: boolean }
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'pdf'; readonly base64: string }
  | { readonly kind: 'confirm'; readonly reason?: 'binary' | 'large'; readonly byteLength: number };

/** Decode a base64 payload into a Blob (for a PDF object URL — avoids the
 *  data-URL size limits Chromium's PDF viewer hits on big files). */
function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Human-readable byte size (e.g. "5.2 MB"). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * The right-hand viewer for the Files panes. `diff` mode shows a changed file's
 * `git diff`; `content` mode opens any file via `workspace.readFile` — images
 * render inline, text/code as UTF-8, and binary/large files prompt before being
 * opened as text (a huge blob in a <pre> can crash the renderer).
 */
export function FileViewer({
  workspaceId,
  path,
  mode,
}: {
  readonly workspaceId: string | null;
  readonly path: string | null;
  readonly mode: FileViewMode;
}): JSX.Element {
  const [body, setBody] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set when the user confirms "open anyway" past the binary/large gate.
  const [force, setForce] = useState(false);
  // Object URL for a PDF body, created/revoked alongside it.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // A fresh selection starts gated again.
  useEffect(() => setForce(false), [path, mode]);

  // Maintain a revocable object URL whenever the body is a PDF. A malformed /
  // non-base64 payload makes atob throw a DOMException — catch it and fall back
  // to the regular error state instead of letting it escape the effect.
  useEffect(() => {
    if (!body || !('kind' in body) || body.kind !== 'pdf') {
      setPdfUrl(null);
      return;
    }
    let u: string;
    try {
      u = URL.createObjectURL(base64ToBlob(body.base64, 'application/pdf'));
    } catch {
      setPdfUrl(null);
      setError('Could not open this PDF — the file appears to be corrupt.');
      return;
    }
    setPdfUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [body]);

  useEffect(() => {
    if (!workspaceId || !path) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (mode === 'diff') {
          const res = await api().invoke('git.diff', { workspaceId, path });
          if (!cancelled) setBody({ diff: res.diff });
          return;
        }
        const res = await api().invoke('workspace.readFile', { workspaceId, path, force });
        if (cancelled) return;
        if (res.kind === 'image') {
          setBody({ kind: 'image', src: `data:${res.mediaType ?? 'image/png'};base64,${res.base64 ?? ''}` });
        } else if (res.kind === 'pdf') {
          setBody({ kind: 'pdf', base64: res.base64 ?? '' });
        } else if (res.kind === 'confirm') {
          setBody({ kind: 'confirm', reason: res.reason, byteLength: res.byteLength });
        } else {
          setBody({ kind: 'text', content: res.content, truncated: res.truncated });
        }
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path, mode, force]);

  if (!path) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>
        Select a file to view it.
      </div>
    );
  }
  if (loading) return <div style={pad}>Loading…</div>;
  if (error) return <div style={{ ...pad, color: 'var(--color-danger, #f87171)' }}>{error}</div>;
  if (!body) return <div style={pad} />;

  if ('diff' in body) return <DiffView diff={body.diff} />;

  if (body.kind === 'image') {
    return (
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          background: 'var(--color-input-soft)',
          borderRadius: 8,
        }}
      >
        <img
          src={body.src}
          alt={path}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    );
  }

  if (body.kind === 'pdf') {
    return pdfUrl ? (
      <iframe
        src={pdfUrl}
        title={path}
        style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#fff' }}
      />
    ) : (
      <div style={pad}>Loading…</div>
    );
  }

  if (body.kind === 'confirm') {
    const what =
      body.reason === 'binary'
        ? 'This looks like a binary file.'
        : `This file is large (${formatBytes(body.byteLength)}).`;
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
            color: 'var(--color-primary)',
          }}
        >
          <Icon name="file" size={20} />
        </div>
        <div style={{ maxWidth: 300 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{what}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
            Opening it as text may be slow or show garbled content.
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setForce(true)}>
          Open as text anyway
        </Button>
      </div>
    );
  }

  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: 10,
        fontSize: 11.5,
        lineHeight: 1.5,
        overflow: 'auto',
        height: '100%',
        background: 'var(--color-input-soft)',
        borderRadius: 8,
        whiteSpace: 'pre',
        color: 'var(--color-text-muted)',
      }}
    >
      {body.content}
      {body.truncated ? '\n\n… (truncated)' : ''}
    </pre>
  );
}

const pad: React.CSSProperties = { padding: 16, fontSize: 12, color: 'var(--color-text-dim)' };
