import { useState } from 'react';
import type { TriggerOrigin } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';
import { describeTrigger } from './trigger-meta';

/**
 * Compact marker for a machine-initiated turn (a fired webhook / schedule /
 * triggered workflow). Replaces the raw synthesized prompt — which is often a
 * large block carrying an untrusted webhook payload — with a one-line chip
 * ("Webhook received · github-issues") that expands to reveal the full prompt
 * for debugging. The prompt text still lives in the event (and the model's
 * context); this only changes how it's displayed. See {@link TriggerOrigin}.
 */

export function TriggerBlock({
  origin,
  text,
}: {
  readonly origin: TriggerOrigin;
  readonly text: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { icon, label } = describeTrigger(origin);
  return (
    <div
      data-testid="block-trigger"
      style={{ alignSelf: 'flex-start', maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide the trigger payload' : 'Show the trigger payload'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 12px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 'var(--radius-pill)',
          fontSize: 'var(--type-row)',
          color: 'var(--color-text-dim)',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        <Icon name={icon} size={13} />
        <span>
          {label} · <span style={{ color: 'var(--color-text)' }}>{origin.name}</span>
        </span>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
            opacity: 0.7,
          }}
        >
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {expanded && (
        <div
          className="mono"
          style={{
            padding: '10px 12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 'var(--radius-card)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 'var(--type-row)',
            lineHeight: 1.5,
            color: 'var(--color-text-dim)',
            maxHeight: 360,
            overflow: 'auto',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
