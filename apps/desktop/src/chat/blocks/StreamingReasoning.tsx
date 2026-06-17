import { Icon } from '@moxxy/desktop-ui';
import { MarkdownBody } from '../MarkdownBody';

/** Live reasoning preview while the model is still thinking — shown in
 *  place of the dead "thinking…" dots for a reasoning model. Visually
 *  subdued (dim avatar + muted body) so it reads as the model's scratch
 *  thinking, not its final answer; replaced by StreamingAssistant the
 *  moment the answer text starts to arrive. */
export function StreamingReasoning({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      data-testid="block-streaming-reasoning"
      style={{ alignSelf: 'stretch', display: 'flex', gap: 12, maxWidth: '92%', opacity: 0.7 }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: 'var(--color-input-soft)',
          color: 'var(--color-text-dim)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name="agent" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-text-muted)' }}>
            Thinking
          </span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--color-text-dim)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
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
            thinking…
          </span>
        </div>
        <div style={{ marginTop: 6, color: 'var(--color-text-muted)' }}>
          <MarkdownBody text={text} streaming />
        </div>
      </div>
    </div>
  );
}
