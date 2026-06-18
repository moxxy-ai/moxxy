import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { isSettled, pairToolEvents } from './pair-events.js';
import type { CollaborationBlock } from './types.js';

let seq = 0;
function ce(subtype: string, payload: unknown): MoxxyEvent {
  seq += 1;
  return {
    type: 'plugin_event',
    id: `e${seq}`,
    ts: seq * 1000,
    sessionId: 's',
    turnId: 't',
    source: 'plugin',
    pluginId: '@moxxy/mode-collaborative',
    subtype,
    payload,
  } as unknown as MoxxyEvent;
}

describe('collaboration fold', () => {
  it('folds a collab_* stream into one team block', () => {
    const events: MoxxyEvent[] = [
      { type: 'user_prompt', id: 'u1', ts: 0, sessionId: 's', turnId: 't', source: 'user', text: 'build' } as unknown as MoxxyEvent,
      ce('collab_started', { task: 'build the thing', parallel: true }),
      ce('collab_roster_proposed', {
        roster: [
          { id: 'backend', name: 'Backend', role: 'implementer', subtask: 'api' },
          { id: 'tests', name: 'Tests', role: 'implementer', subtask: 'tests' },
        ],
      }),
      ce('collab_agent_spawned', { id: 'architect', role: 'architect' }),
      ce('collab_contract_published', {
        kind: 'contract',
        action: 'published',
        contract: { id: 'c1', title: 'API', owner: 'backend', status: 'published', version: 1 },
      }),
      ce('collab_agent_spawned', { id: 'backend', role: 'implementer' }),
      ce('collab_message', { kind: 'message', message: { id: 'm1', from: 'backend', to: 'all', body: 'starting', ts: 5000 } }),
      ce('collab_board_update', { kind: 'board', action: 'claim', item: { id: 't1', title: 'api.ts', status: 'claimed', owner: 'backend' } }),
      ce('collab_agent_done', { kind: 'agent_done', agentId: 'backend', summary: 'done api' }),
      ce('collab_control', { kind: 'control', control: { paused: true } }),
      ce('collab_conflict', { agentId: 'tests', files: ['shared.ts'] }),
      ce('collab_completed', { done: ['backend'], total: 2 }),
    ];

    const blocks = pairToolEvents(events);
    const collabBlocks = blocks.filter((b) => b.kind === 'collab');
    expect(collabBlocks).toHaveLength(1);
    const collab = collabBlocks[0] as CollaborationBlock;

    expect(collab.task).toBe('build the thing');
    expect(collab.parallel).toBe(true);
    expect(collab.agents.map((a) => a.id).sort()).toEqual(['architect', 'backend', 'tests']);
    expect(collab.agents.find((a) => a.id === 'backend')?.status).toBe('done');
    expect(collab.agents.find((a) => a.id === 'backend')?.summary).toBe('done api');
    expect(collab.messages.map((m) => m.body)).toEqual(['starting']);
    expect(collab.tasks[0]?.status).toBe('claimed');
    expect(collab.contracts[0]?.title).toBe('API');
    expect(collab.control?.paused).toBe(true);
    expect(collab.conflicts[0]?.files).toEqual(['shared.ts']);
    expect(collab.completedAtMs).not.toBeNull();
    expect(collab.doneCount).toBe(1);
    expect(collab.totalCount).toBe(2);
    expect(isSettled(collab)).toBe(true);
  });

  it('a running collaboration is not settled', () => {
    const events: MoxxyEvent[] = [ce('collab_started', { task: 'x', parallel: false })];
    const collab = pairToolEvents(events).find((b) => b.kind === 'collab') as CollaborationBlock;
    expect(collab.fallbackReason).toBeNull();
    expect(isSettled(collab)).toBe(false);
  });
});
