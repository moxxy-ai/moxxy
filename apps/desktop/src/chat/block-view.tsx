import type { Block } from '@/lib/runner-session';

/**
 * Single source of truth for how each transcript block renders.
 *
 * Kept as a separate component (not inlined into Transcript) so each
 * variant has a small, predictable surface area for snapshot tests and
 * for future styling tweaks (markdown rendering in assistant blocks,
 * tool-arg inspectors, etc.).
 */
export function BlockView({ block }: { readonly block: Block }): JSX.Element {
  switch (block.kind) {
    case 'user':
      return <UserBlock text={block.text} />;
    case 'assistant':
      return <AssistantBlock text={block.text} streaming={block.streaming} />;
    case 'tool':
      return (
        <ToolBlock
          name={block.name}
          status={block.status}
          summary={block.summary}
        />
      );
    case 'system':
      return <SystemBlock text={block.text} />;
    case 'error':
      return <ErrorBlock text={block.text} />;
  }
}

function UserBlock({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      data-testid="block-user"
      style={{
        alignSelf: 'flex-end',
        maxWidth: '70%',
        padding: '0.5rem 0.75rem',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

function AssistantBlock({
  text,
  streaming,
}: {
  readonly text: string;
  readonly streaming: boolean;
}): JSX.Element {
  return (
    <div
      data-testid="block-assistant"
      data-streaming={streaming}
      className="corner-bracket"
      style={{
        maxWidth: '85%',
        padding: '0.75rem 1rem',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        whiteSpace: 'pre-wrap',
        lineHeight: 'var(--leading-body)',
      }}
    >
      {text}
      {streaming && (
        <span
          aria-hidden
          className="streaming-cursor"
          style={{ marginLeft: 4, color: 'var(--color-primary)' }}
        >
          ▍
        </span>
      )}
    </div>
  );
}

function ToolBlock({
  name,
  status,
  summary,
}: {
  readonly name: string;
  readonly status: 'running' | 'done' | 'error';
  readonly summary?: string;
}): JSX.Element {
  const accent =
    status === 'error'
      ? 'var(--color-pink)'
      : status === 'done'
        ? 'var(--color-green)'
        : 'var(--color-primary)';
  return (
    <div
      data-testid="block-tool"
      data-status={status}
      className="mono"
      style={{
        alignSelf: 'flex-start',
        fontSize: '0.75rem',
        padding: '0.25rem 0.5rem',
        color: 'var(--color-text-dim)',
        borderLeft: `2px solid ${accent}`,
        display: 'flex',
        gap: '0.5rem',
      }}
    >
      <span style={{ color: accent }}>[{status}]</span>
      <span>{name}</span>
      {summary && (
        <span
          style={{
            color: 'var(--color-text-dim)',
            opacity: 0.7,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '40rem',
          }}
        >
          {summary}
        </span>
      )}
    </div>
  );
}

function SystemBlock({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      data-testid="block-system"
      role="status"
      className="mono"
      style={{
        alignSelf: 'center',
        fontSize: '0.7rem',
        padding: '0.25rem 0.6rem',
        color: 'var(--color-text-dim)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      — {text} —
    </div>
  );
}

function ErrorBlock({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      data-testid="block-error"
      role="alert"
      style={{
        alignSelf: 'stretch',
        padding: '0.5rem 0.75rem',
        background: 'color-mix(in oklab, var(--color-pink) 12%, transparent)',
        border: '1px solid var(--color-pink)',
        borderRadius: 'var(--radius-block)',
        color: 'var(--color-text)',
        fontSize: '0.875rem',
      }}
    >
      {text}
    </div>
  );
}
