import { useRef, useState } from 'react';
import { useSurface } from './useSurface';

/**
 * Generic "text/log" renderer for plugin-contributed embedded windows. A plugin
 * defines a runner surface (kind `text`) that emits `{ type: 'text', text }`
 * (replace) or `{ type: 'append', chunk }` (stream). Rendered as scrolling
 * monospace text via React text nodes — NEVER innerHTML — so plugin output can't
 * inject markup. One of the closed, audited renderers (see registry safety model).
 */
export function TextPane({
  workspaceId,
  kind = 'text',
}: {
  readonly workspaceId: string | null;
  readonly kind?: string;
}): JSX.Element {
  const [text, setText] = useState('');
  const bufRef = useRef('');

  const apply = (p: unknown): void => {
    if (!p || typeof p !== 'object') return;
    const o = p as Record<string, unknown>;
    if (o.type === 'text' && typeof o.text === 'string') {
      bufRef.current = o.text;
      setText(o.text);
    } else if (o.type === 'append' && typeof o.chunk === 'string') {
      bufRef.current += o.chunk;
      setText(bufRef.current);
    }
  };

  const { error } = useSurface(workspaceId, kind, { onSnapshot: apply, onData: apply });

  if (error) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>{error}</div>;
  }

  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: 12,
        fontSize: 11.5,
        lineHeight: 1.5,
        height: '100%',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--color-text-muted)',
        background: 'var(--color-input-soft)',
        borderRadius: 8,
      }}
    >
      {text || '(no output yet)'}
    </pre>
  );
}
