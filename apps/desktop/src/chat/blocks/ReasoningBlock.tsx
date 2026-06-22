import { useState } from 'react';
import type { ReasoningMessageEvent } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';
import { MarkdownBody } from '../MarkdownBody';

/**
 * A finalized reasoning summary persisted in the log — the model's thinking
 * that preceded the following tool calls / answer text. Rendered DIM and
 * COLLAPSED by default (a "Thinking" header + chevron); expanding reveals the
 * markdown summary. Redacted reasoning is never expandable — a static
 * "[reasoning withheld]" line stands in for the opaque blob.
 */
export function ReasoningBlock({ event }: { readonly event: ReasoningMessageEvent }): JSX.Element {
  const [open, setOpen] = useState(false);

  if (event.redacted) {
    return (
      <div
        data-testid="block-reasoning"
        className="mono"
        style={{
          alignSelf: 'stretch',
          maxWidth: '92%',
          fontSize: 11,
          color: 'var(--color-text-dim)',
          fontStyle: 'italic',
          padding: '2px 0',
        }}
      >
        [reasoning withheld]
      </div>
    );
  }

  return (
    <div data-testid="block-reasoning" style={{ alignSelf: 'stretch' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 0',
          textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          Thought Process
        </span>
        <span
          aria-hidden
          style={{
            color: 'var(--color-text-dim)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
            display: 'inline-flex',
          }}
        >
          <Icon name="chevron-right" size={14} />
        </span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: 14,
            borderLeft: '2px solid var(--color-card-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <MarkdownBody text={event.content} />
        </div>
      )}
    </div>
  );
}
