import { useEffect, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { DiffView } from './DiffView';

export type FileViewMode = 'diff' | 'content';

/**
 * The right-hand viewer for the Files pane. In `diff` mode it shows a changed
 * file's `git diff`; in `content` mode it shows the full file via
 * `workspace.readFile`. Empty until a file is selected.
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
  const [body, setBody] = useState<{ diff: string } | { content: string; truncated: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        } else {
          const res = await api().invoke('workspace.readFile', { workspaceId, path });
          if (!cancelled) setBody({ content: res.content, truncated: res.truncated });
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
  }, [workspaceId, path, mode]);

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
