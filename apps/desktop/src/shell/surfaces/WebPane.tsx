import { useState } from 'react';
import { useSurface } from './useSurface';

/**
 * Generic "web" renderer for plugin-contributed embedded windows. A plugin
 * defines a runner surface (kind `web`) that emits `{ type: 'html', html }` or
 * `{ type: 'url', url }`; this renders it in a HARD-sandboxed iframe.
 *
 * Safety: plugin payloads are UNTRUSTED. The iframe runs with `sandbox` and
 * WITHOUT `allow-same-origin`/`allow-scripts`, so framed content can never reach
 * the app origin/IPC. Payload shape is validated before use; unknown shapes are
 * ignored. This is one of the closed, audited renderers — no plugin code runs in
 * the renderer (see the surface registry safety model).
 */
export function WebPane({
  workspaceId,
  kind = 'web',
}: {
  readonly workspaceId: string | null;
  readonly kind?: string;
}): JSX.Element {
  const [doc, setDoc] = useState<{ html: string } | { url: string } | null>(null);

  const { error } = useSurface(workspaceId, kind, {
    onSnapshot: (s) => setDoc(coerce(s)),
    onData: (p) => {
      const next = coerce(p);
      if (next) setDoc(next);
    },
  });

  if (error) return <Msg text={`Couldn’t open this view: ${error}`} />;
  if (!doc) return <Msg text="Waiting for content…" />;

  return (
    <iframe
      title="plugin view"
      sandbox=""
      {...('html' in doc ? { srcDoc: doc.html } : { src: doc.url })}
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
    />
  );
}

/** Validate/normalize an untrusted surface payload to a known shape, or null. */
function coerce(p: unknown): { html: string } | { url: string } | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (o.type === 'html' && typeof o.html === 'string') return { html: o.html };
  if (o.type === 'url' && typeof o.url === 'string' && /^https?:\/\//i.test(o.url)) {
    return { url: o.url };
  }
  return null;
}

function Msg({ text }: { readonly text: string }): JSX.Element {
  return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>{text}</div>;
}
