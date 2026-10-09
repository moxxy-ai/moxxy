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
    <div className="trigger" data-testid="block-trigger">
      <button
        type="button"
        className="trigger__chip"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide the trigger payload' : 'Show the trigger payload'}
      >
        <Icon name={icon} size={13} />
        <span>
          {label} · <b>{origin.name}</b>
        </span>
        <span className="disclosure__chevron" data-open={expanded} aria-hidden>
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {expanded && <div className="trigger__payload">{text}</div>}
    </div>
  );
}
