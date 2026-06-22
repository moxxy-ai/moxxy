import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { MarkdownBody } from '../MarkdownBody';
import { SkipButton } from './SkipButton';

/** Live reasoning preview while the model is still thinking (z.ai "Thinking… ›"
 *  pattern). A collapsible header with an animated dot, expanded by default so
 *  the user can watch the scratch thinking; the body is a left-bordered indent.
 *  A "Skip" button (= abort the turn) sits on the right while live. Replaced by
 *  StreamingAssistant the moment answer text starts arriving. */
export function StreamingReasoning({
  text,
  onSkip,
}: {
  readonly text: string;
  readonly onSkip?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid="block-streaming-reasoning" style={{ alignSelf: 'stretch', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left' }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-text-dim)',
              animation: 'moxxy-thinking 1.1s ease-in-out infinite',
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            Thinking…
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
        <span style={{ flex: 1 }} />
        {onSkip && <SkipButton onSkip={onSkip} />}
      </div>
      {open && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: 14,
            borderLeft: '2px solid var(--color-card-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <MarkdownBody text={text} streaming />
        </div>
      )}
    </div>
  );
}
