import { useEffect, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';

/** Extensions we render as a live preview (rest fall back to the code view). */
export function isPreviewable(path: string | null): boolean {
  if (!path) return false;
  return /\.(html?|svg)$/i.test(path);
}

/**
 * Rendered preview of an HTML/SVG file inside a HARD-sandboxed iframe.
 *
 * Security: the content is agent-generated and the renderer is privileged, so
 * the iframe runs with `sandbox` and WITHOUT `allow-same-origin`/`allow-scripts`
 * — it can never reach the app origin/IPC or run scripts. (Combining those two
 * flags would let the framed doc remove its own sandbox.) This is a static
 * render; scripted preview would need an explicit opt-in and is out of scope.
 */
export function FilePreview({
  workspaceId,
  path,
}: {
  readonly workspaceId: string | null;
  readonly path: string | null;
}): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !path) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const res = await api().invoke('workspace.readFile', { workspaceId, path, force: true });
        if (cancelled) return;
        if (res.kind === 'text') setHtml(res.content);
        else setError('This file can’t be previewed.');
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path]);

  if (error) return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>{error}</div>;
  if (html === null) return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>Loading…</div>;

  return (
    <iframe
      title={path ?? 'preview'}
      // No allow-same-origin / allow-scripts — see the security note above.
      sandbox=""
      srcDoc={html}
      style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#fff' }}
    />
  );
}
