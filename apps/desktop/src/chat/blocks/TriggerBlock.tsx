import { useState } from 'react';
import type { TriggerOrigin } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';
import { describeTrigger } from './trigger-meta';
import { useOpenAgentWork } from '../agent-work-link';

/**
 * Compact marker for a machine-initiated turn (a fired webhook / schedule /
 * triggered workflow). Replaces the raw synthesized prompt — which is often a
 * large block carrying an untrusted webhook payload — with a one-line chip
 * ("Webhook received · github-issues") that expands to reveal the full prompt
 * for debugging. The prompt text still lives in the event (and the model's
 * context); this only changes how it's displayed. See {@link TriggerOrigin}.
 *
 * A turn the agent took up after its background work ("Agent continued")
 * carries no payload worth showing: its prompt is its name. Its chip opens
 * that work in the Agents pane instead, when it says which work it was.
 */

export function TriggerBlock({
  origin,
  text,
  eventId,
}: {
  readonly origin: TriggerOrigin;
  readonly text: string;
  /** The prompt's event, so the Agents pane can scroll the chat back to it. */
  readonly eventId?: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const openWork = useOpenAgentWork();
  const { icon, label } = describeTrigger(origin);
  const chip = (
    <>
      <Icon name={icon} size={13} />
      <span className="trigger__label">
        {label} ·{' '}
        <b className="trigger__name" title={origin.name}>
          {origin.name}
        </b>
      </span>
    </>
  );
  if (origin.kind === 'agent') {
    const workId = origin.workId;
    return (
      <div className="trigger" data-testid="block-trigger" data-event-id={eventId}>
        {workId && openWork ? (
          <button type="button" className="trigger__chip" onClick={() => openWork(workId)} title="Show this work in the Agents pane">
            {chip}
            <Icon name="chevron-right" size={12} />
          </button>
        ) : (
          <span className="trigger__chip">{chip}</span>
        )}
      </div>
    );
  }
  return (
    <div className="trigger" data-testid="block-trigger" data-event-id={eventId}>
      <button
        type="button"
        className="trigger__chip"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide the trigger payload' : 'Show the trigger payload'}
      >
        {chip}
        <span className="disclosure__chevron" data-open={expanded} aria-hidden>
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {expanded && <div className="trigger__payload">{text}</div>}
    </div>
  );
}
