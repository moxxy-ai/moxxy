import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { EventLine, formatCompactionEvent, formatTriggerOrigin, formatUserPromptRows } from './EventLine.js';

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

describe('EventLine for a compaction', () => {
  const compaction = (routine?: true) =>
    ({
      id: asEventId('e2'),
      seq: 20,
      ts: 1,
      type: 'compaction',
      sessionId: asSessionId('s1'),
      turnId: asTurnId('t2'),
      source: 'compactor',
      compactor: 'segments',
      replacedRange: [4, 9],
      summary: '[segment 2 · turn t1 · seq 4-9]\nAsked: x',
      tokensSaved: 6_100,
      ...(routine ? { routine } : {}),
    }) satisfies MoxxyEvent;

  it('shows nothing for the routine record of a finished turn', () => {
    expect(EventLine({ event: compaction(true) })).toBeNull();
  });

  it('still shows a compaction the context forced', () => {
    expect(EventLine({ event: compaction() })).not.toBeNull();
  });
});

describe('formatTriggerOrigin', () => {
  it('uses compact origin-aware labels for machine and checkpoint prompts', () => {
    expect(formatTriggerOrigin({ kind: 'webhook', name: 'github' })).toBe('Webhook received');
    expect(formatTriggerOrigin({ kind: 'schedule', name: 'morning' })).toBe('Schedule fired');
    expect(formatTriggerOrigin({ kind: 'agent', name: 'List files finished in the background' })).toBe('Agent continued');
    expect(formatTriggerOrigin({ kind: 'workflow', name: 'release' })).toBe('Workflow ran');
    expect(formatTriggerOrigin({ kind: 'checkpoint', name: 'verify' })).toBe('Checkpoint intervened');
    expect(formatTriggerOrigin({ kind: 'voice', name: '2 exchanges while the agent worked' })).toBe('Voice conversation');
  });
});

describe('formatUserPromptRows', () => {
  it('fills the available row and wraps long prompts inside the band', () => {
    const rows = formatUserPromptRows('Ask about this workspace and verify the result', 24);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^ {2}Ask about this/);
    expect(rows[1]).toMatch(/^ {2}workspace and/);
    expect(rows.every((row) => row.length === 24)).toBe(true);
  });
});

describe("EventLine for an agent's account limit", () => {
  const limit = (state: 'reached' | 'near') =>
    ({
      id: asEventId('e3'),
      seq: 30,
      ts: 1,
      type: 'plugin_event',
      sessionId: asSessionId('s1'),
      turnId: asTurnId('t3'),
      source: 'system',
      pluginId: '@moxxy/agent-connection' as never,
      subtype: 'account_limit',
      payload: { provider: 'claude-code', agent: 'Claude', limit: { state } },
    }) satisfies MoxxyEvent;

  it('says where the turn stopped that the limit is used up', () => {
    expect(JSON.stringify(EventLine({ event: limit('reached') }))).toContain("Claude's usage limit is used up");
  });

  it('leaves a limit with room left to the line above the prompt', () => {
    expect(EventLine({ event: limit('near') })).toBeNull();
  });
});

describe('EventLine for a turn the agent took up by itself and finished without replying', () => {
  it('says the agent finished without replying', () => {
    const noReply = {
      id: asEventId('e4'),
      seq: 40,
      ts: 1,
      type: 'plugin_event',
      sessionId: asSessionId('s1'),
      turnId: asTurnId('t4'),
      source: 'system',
      pluginId: '@moxxy/agent-connection' as never,
      subtype: 'no_reply',
      payload: {},
    } satisfies MoxxyEvent;

    expect(JSON.stringify(EventLine({ event: noReply }))).toContain('The agent finished without replying.');
  });
});
