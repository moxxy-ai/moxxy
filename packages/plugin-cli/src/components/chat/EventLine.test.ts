import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { formatCompactionEvent, formatTriggerOrigin } from './EventLine.js';

describe('formatCompactionEvent', () => {
  it('renders a compact, readable compaction summary', () => {
    const event = {
      id: asEventId('e1'),
      seq: 10,
      ts: 1,
      type: 'compaction',
      sessionId: asSessionId('s1'),
      turnId: asTurnId('t1'),
      source: 'compactor',
      compactor: 'summarize-old-turns',
      replacedRange: [0, 10_526],
      summary: 'old summary',
      tokensSaved: 315_810,
    } satisfies MoxxyEvent;

    expect(formatCompactionEvent(event)).toBe(
      'context compacted · 10,527 events · ~315.8k tokens saved',
    );
  });
});

describe('formatTriggerOrigin', () => {
  it('uses compact origin-aware labels for machine and checkpoint prompts', () => {
    expect(formatTriggerOrigin({ kind: 'webhook', name: 'github' })).toBe('Webhook received');
    expect(formatTriggerOrigin({ kind: 'schedule', name: 'morning' })).toBe('Schedule fired');
    expect(formatTriggerOrigin({ kind: 'workflow', name: 'release' })).toBe('Workflow ran');
    expect(formatTriggerOrigin({ kind: 'checkpoint', name: 'verify' })).toBe('Checkpoint intervened');
  });
});
