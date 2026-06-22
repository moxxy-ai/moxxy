/**
 * "Thinking…" placeholder rendered between send and the agent's first chunk
 * (z.ai pattern): a minimal label + animated dots on the left, a "Skip" button
 * on the right. No avatar — the assistant turn is full-width plain text. Once
 * any reasoning/answer text arrives, this is replaced.
 */

import { SkipButton } from './blocks/SkipButton';

export function ThinkingIndicator({ onSkip }: { readonly onSkip?: () => void }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Thinking…
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span className="thinking-dot" style={{ animationDelay: '0ms' }} />
        <span className="thinking-dot" style={{ animationDelay: '160ms' }} />
        <span className="thinking-dot" style={{ animationDelay: '320ms' }} />
      </span>
      <span style={{ flex: 1 }} />
      {onSkip && <SkipButton onSkip={onSkip} />}
    </div>
  );
}
