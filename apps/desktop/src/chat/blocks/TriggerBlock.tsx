import { useState } from 'react';
import type { TriggerOrigin } from '@moxxy/sdk';
import { Icon, type IconName } from '@moxxy/desktop-ui';

/**
 * Compact marker for a machine-initiated turn (a fired webhook / schedule /
 * triggered workflow). Replaces the raw synthesized prompt — which is often a
 * large block carrying an untrusted webhook payload — with a one-line chip
 * ("Webhook received · github-issues") that expands to reveal the full prompt
 * for debugging. The prompt text still lives in the event (and the model's
 * context); this only changes how it's displayed. See {@link TriggerOrigin}.
 */

const KIND_META: Record<TriggerOrigin['kind'], { readonly icon: IconName; readonly verb: string }> = {
  webhook: { icon: 'bell', verb: 'received' },
  schedule: { icon: 'rotate', verb: 'fired' },
  workflow: { icon: 'workflow', verb: 'ran' },
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TriggerBlock({
  origin,
  text,
}: {
  readonly origin: TriggerOrigin;
  readonly text: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[origin.kind];
  const label = `${titleCase(origin.kind)} ${meta.verb}`;
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
          borderRadius: 999,
          fontSize: 12.5,
          color: 'var(--color-text-dim)',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        <Icon name={meta.icon} size={13} />
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
            borderRadius: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
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
