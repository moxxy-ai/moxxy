import { useState } from 'react';
import { WorkflowsPanel } from '../workflows/WorkflowsPanel';
import { SchedulesPanel } from '../apps/SchedulesPanel';
import { WebhooksPanel } from '../apps/WebhooksPanel';

/**
 * Automations: the things that fire themselves.
 *
 * Workflows, schedules and webhooks used to be chips inside Apps, which put two
 * unrelated families behind one destination — an installable app is something you
 * open, an automation is something that runs without you. They are one family
 * (a trigger, then work) and they get one place.
 *
 * The kind is picked in the INDEX COLUMN rather than from a row of chips in the
 * header, which is the whole point of the column: the rail says where you are, the
 * index says what is in here — see {@link ./AutomationsIndex}, where the kinds are
 * collapsible groups holding the automations themselves.
 */

import type { Kind } from './AutomationsIndex';

/** A pure switch. Each kind's pane owns its own instrument bar, because each has
 *  its own summary and its own actions, and a shared bar here could carry
 *  neither without the panes reaching up through props to fill it. */
export function AutomationsPanel({ kind }: { readonly kind: Kind }): JSX.Element {
  if (kind === 'schedules') return <SchedulesPanel />;
  if (kind === 'webhooks') return <WebhooksPanel />;
  return <WorkflowsPanel />;
}

/** The kind the Automations destination lands on. */
export function useAutomationsKind(): readonly [Kind, (k: Kind) => void] {
  const [kind, setKind] = useState<Kind>('workflows');
  return [kind, setKind];
}
