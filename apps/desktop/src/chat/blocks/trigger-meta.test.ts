import { describe, expect, it } from 'vitest';
import type { TriggerOrigin } from '@moxxy/sdk';
import { describeTrigger } from './trigger-meta';

/** A persisted origin written by a different (e.g. newer) build — outside today's union. */
const foreign = (kind: unknown): TriggerOrigin => ({ kind, name: 'x' }) as unknown as TriggerOrigin;

describe('describeTrigger', () => {
  it.each([
    ['webhook', 'bell', 'Webhook received'],
    ['schedule', 'rotate', 'Schedule fired'],
    ['workflow', 'workflow', 'Workflow ran'],
    ['checkpoint', 'check', 'Checkpoint intervened'],
    ['voice', 'mic', 'Voice conversation'],
  ] as const)('labels the known %s kind', (kind, icon, label) => {
    expect(describeTrigger({ kind, name: 'n' })).toEqual({ icon, label });
  });

  it('falls back to a neutral chip for a kind this build does not know', () => {
    expect(describeTrigger(foreign('telepathy'))).toEqual({ icon: 'bell', label: 'Telepathy trigger' });
  });

  it('falls back to a plain "Trigger" label for a corrupt, non-string kind', () => {
    expect(describeTrigger(foreign(undefined))).toEqual({ icon: 'bell', label: 'Trigger' });
    expect(describeTrigger(foreign(42))).toEqual({ icon: 'bell', label: 'Trigger' });
  });
});
