import { Icon } from '@moxxy/desktop-ui';

/**
 * Pending-turn chip for messages the user queued while a previous
 * turn was still running. Renders with a soft "waiting" pulse so it
 * reads as pending, not "already sent."
 */
export function QueuedChip({
  text,
  onRemove,
  compact = false,
}: {
  readonly text: string;
  readonly onRemove: () => void;
  /** Dense, single-row treatment used by constrained surfaces such as Mini Chat. */
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <span
      title={`Queued · sends when the current turn finishes\n${text}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 5 : 6,
        padding: compact ? '2px 3px 2px 7px' : '4px 4px 4px 10px',
        background: 'var(--color-primary-soft)',
        border: '1px dashed var(--color-primary)',
        borderRadius: compact ? 'var(--radius-chip)' : 'var(--radius-pill)',
        fontSize: compact ? 'var(--type-meta)' : 'var(--type-row)',
        color: 'var(--color-primary-strong)',
        fontWeight: 600,
        maxWidth: compact ? '100%' : 280,
        minWidth: 0,
        boxSizing: 'border-box',
        flex: compact ? '0 1 auto' : undefined,
      }}
    >
      {compact ? (
        <span
          aria-hidden
          style={{
            color: 'var(--focus-muted, var(--color-text-muted))',
            fontSize: 'var(--type-label)',
            fontWeight: 750,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          Queued
        </span>
      ) : (
        <span
          aria-hidden
          data-testid="queued-pulse"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-primary-strong)',
            animation: 'moxxy-thinking 1.1s ease-in-out infinite',
          }}
        />
      )}
      <span
        style={{
          maxWidth: compact ? 'min(42ch, calc(100% - 64px))' : 220,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {text || '(attachment only)'}
      </span>
      <button
        type="button"
        aria-label="Drop queued message"
        onClick={onRemove}
        style={{
          width: compact ? 22 : 18,
          height: compact ? 22 : 18,
          borderRadius: 'var(--radius-chip)',
          background: compact
            ? 'transparent'
            : 'color-mix(in srgb, var(--color-primary) 18%, transparent)',
          color: 'var(--color-primary-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          padding: 0,
        }}
      >
        <Icon name="x" size={11} />
      </button>
    </span>
  );
}
