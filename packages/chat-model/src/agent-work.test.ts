import { describe, expect, it } from 'vitest';
import {
  AGENT_CONNECTION_PLUGIN_ID,
  SUBAGENTS_PLUGIN_ID,
  asEventId,
  asSessionId,
  asTurnId,
  type AgentBackgroundWork,
  type MoxxyEvent,
  type PluginEvent,
  type UserPromptEvent,
} from '@moxxy/sdk';
import { agentWorkFromEvents } from './agent-work.js';

let seq = 0;
const base = () => {
  seq += 1;
  return { id: asEventId(`e${seq}`), seq, ts: seq * 1000, sessionId: asSessionId('s1'), turnId: asTurnId('t1') } as const;
};
const helper = (subtype: string, payload: Record<string, unknown>): PluginEvent => ({
  ...base(),
  type: 'plugin_event',
  source: 'plugin',
  pluginId: SUBAGENTS_PLUGIN_ID,
  subtype,
  payload,
});
const work = (subtype: string, payload: Record<string, unknown>): PluginEvent => ({
  ...base(),
  type: 'plugin_event',
  source: 'system',
  pluginId: AGENT_CONNECTION_PLUGIN_ID,
  subtype,
  payload,
});
const listed = (...items: AgentBackgroundWork[]) => work('background_work', { provider: 'claude-code', work: items });
const continued = (workId: string): UserPromptEvent => ({
  ...base(),
  type: 'user_prompt',
  source: 'system',
  text: 'List files finished in the background',
  origin: { kind: 'agent', name: 'List files finished in the background', workId },
});

const server: AgentBackgroundWork = { id: 'b1', kind: 'command', label: 'npm run dev' };

describe('agentWorkFromEvents', () => {
  it("lists a helper with its prompt, its steps and words in order, and its answer once", () => {
    const events: MoxxyEvent[] = [
      helper('subagent_started', { childSessionId: 'sub-1', label: 'List files', agentType: 'Explore', prompt: 'list the files' }),
      helper('subagent_message', { childSessionId: 'sub-1', text: 'Listing the folder.' }),
      helper('subagent_tool_call', { childSessionId: 'sub-1', name: 'Bash', input: { command: 'ls' } }),
      helper('subagent_message', { childSessionId: 'sub-1', text: 'Two files.' }),
      helper('subagent_completed', { childSessionId: 'sub-1', text: 'Two files.', stopReason: 'end_turn', tokensUsed: 900 }),
    ];

    const [item] = agentWorkFromEvents(events);

    expect(item).toMatchObject({
      id: 'sub-1',
      kind: 'agent',
      label: 'List files',
      agentType: 'Explore',
      prompt: 'list the files',
      status: 'completed',
      answer: 'Two files.',
      tokensUsed: 900,
      error: null,
    });
    expect(item?.steps).toEqual([
      { kind: 'message', text: 'Listing the folder.' },
      { kind: 'tool', name: 'Bash', input: { command: 'ls' } },
    ]);
    expect(item?.endedAtMs).toBeGreaterThan(item?.startedAtMs ?? Infinity);
  });

  it('tells a helper the person stopped from one that failed', () => {
    const events: MoxxyEvent[] = [
      helper('subagent_started', { childSessionId: 'a', label: 'One', agentType: 'default' }),
      helper('subagent_started', { childSessionId: 'b', label: 'Two', agentType: 'default' }),
      helper('subagent_completed', { childSessionId: 'a', text: '', stopReason: 'stopped', error: 'The subagent was stopped.' }),
      helper('subagent_completed', { childSessionId: 'b', text: '', stopReason: 'error', error: 'It crashed.' }),
    ];

    expect(agentWorkFromEvents(events).map((item) => [item.id, item.status, item.error])).toEqual([
      ['b', 'failed', 'It crashed.'],
      ['a', 'stopped', 'The subagent was stopped.'],
    ]);
  });

  it('lists a background command while it runs, and how it ended with what it printed last', () => {
    const running = agentWorkFromEvents([listed(server)]);
    expect(running).toMatchObject([{ id: 'b1', kind: 'command', label: 'npm run dev', status: 'running', output: null, endedAtMs: null }]);

    const ended = agentWorkFromEvents([
      listed(server),
      listed(),
      work('background_work_ended', { provider: 'claude-code', id: 'b1', kind: 'command', label: 'npm run dev', status: 'failed', summary: 'exit 1', output: 'Error: port taken' }),
    ]);
    expect(ended).toMatchObject([{ id: 'b1', status: 'failed', summary: 'exit 1', output: 'Error: port taken' }]);
    expect(ended[0]?.endedAtMs).not.toBeNull();
  });

  it('ends what dropped off the list with no end of its own as stopped: the agent is gone', () => {
    expect(agentWorkFromEvents([listed(server), listed()])).toMatchObject([{ id: 'b1', status: 'stopped' }]);
  });

  it('believes what runs now over the log, so a restarted runner shows nothing stale running', () => {
    expect(agentWorkFromEvents([listed(server)], [])).toMatchObject([{ id: 'b1', status: 'stopped' }]);
    const late = { id: 'b2', kind: 'command' as const, label: 'tail -f log' };
    expect(agentWorkFromEvents([listed(server)], [server, late]).map((item) => [item.id, item.status])).toEqual([
      ['b2', 'running'],
      ['b1', 'running'],
    ]);
  });

  it("keeps a helper Moxxy's own agent runs in a turn running, though no background list names it", () => {
    const events = [helper('subagent_started', { childSessionId: 'own', label: 'Research', agentType: 'default' })];

    expect(agentWorkFromEvents(events, [])).toMatchObject([{ id: 'own', status: 'running' }]);
  });

  it('knows the turn the agent opened when a work ended, so the chat and the panel point at each other', () => {
    const prompt = continued('sub-1');
    const events: MoxxyEvent[] = [
      helper('subagent_started', { childSessionId: 'sub-1', label: 'List files', agentType: 'Explore' }),
      listed({ id: 'sub-1', kind: 'agent', label: 'List files' }),
      helper('subagent_completed', { childSessionId: 'sub-1', text: 'Two files.', stopReason: 'end_turn' }),
      prompt,
    ];

    expect(agentWorkFromEvents(events)[0]).toMatchObject({ id: 'sub-1', status: 'completed', continuedBy: prompt.id });
  });

  it('lists the newest work first', () => {
    const events: MoxxyEvent[] = [
      helper('subagent_started', { childSessionId: 'old', label: 'Old', agentType: 'default' }),
      listed(server),
    ];

    expect(agentWorkFromEvents(events).map((item) => item.id)).toEqual(['b1', 'old']);
  });
});
