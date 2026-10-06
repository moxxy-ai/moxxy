import type { TriggerOrigin } from '@moxxy/sdk';
import type { IconName } from '@moxxy/desktop-ui';

const KIND_META: Record<TriggerOrigin['kind'], { readonly icon: IconName; readonly verb: string }> = {
  webhook: { icon: 'bell', verb: 'received' },
  schedule: { icon: 'rotate', verb: 'fired' },
  workflow: { icon: 'workflow', verb: 'ran' },
  // Mid-turn feedback injected by the ReAct loop's turn-end checkpoint gate
  // (lint report, reviewer verdict) — chip label reads "Checkpoint intervened".
  checkpoint: { icon: 'check', verb: 'intervened' },
  // Voice conversation held while the agent worked — "Voice conversation".
  voice: { icon: 'mic', verb: 'conversation' },
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Icon + label for a trigger marker. Origins come from persisted session logs,
 * which another (newer) build may have written with a kind this build doesn't
 * know — that must degrade to a neutral chip, never crash the chat render.
 */
export function describeTrigger(origin: TriggerOrigin): { readonly icon: IconName; readonly label: string } {
  const kind: unknown = origin.kind;
  if (typeof kind !== 'string' || kind.length === 0) return { icon: 'bell', label: 'Trigger' };
  const meta = Object.hasOwn(KIND_META, kind) ? KIND_META[kind as TriggerOrigin['kind']] : undefined;
  if (!meta) return { icon: 'bell', label: `${titleCase(kind)} trigger` };
  return { icon: meta.icon, label: `${titleCase(kind)} ${meta.verb}` };
}
