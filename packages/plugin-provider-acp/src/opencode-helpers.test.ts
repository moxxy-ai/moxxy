import { describe, expect, it } from 'vitest';
import type { OpenCodeEvent } from './opencode-api.js';
import { OpenCodeHelpers } from './opencode-helpers.js';

const PARENT = 'ses_parent';
const CHILD = 'ses_child';

const event = (type: string, properties: Record<string, unknown>): OpenCodeEvent => ({ type, properties });
const taskPart = (background: boolean) =>
  event('message.part.updated', {
    sessionID: PARENT,
    part: {
      type: 'tool',
      tool: 'task',
      callID: 'call_1',
      sessionID: PARENT,
      state: { status: 'running', title: 'inspect', input: { description: 'inspect', prompt: 'p', ...(background ? { background: true } : {}) }, metadata: { sessionId: CHILD, ...(background ? { background: true } : {}) } },
    },
  });
const childText = (id: string, text: string, finished = true) =>
  event('message.part.updated', { sessionID: CHILD, part: { type: 'text', id, sessionID: CHILD, text, ...(finished ? { time: { start: 1, end: 2 } } : {}) } });
const childIdle = event('session.status', { sessionID: CHILD, status: { type: 'idle' } });

describe("OpenCode's subagents, read from its events", () => {
  it('ends a background subagent that failed with the reason OpenCode gives', () => {
    const helpers = new OpenCodeHelpers(() => PARENT);
    helpers.take(taskPart(true));
    helpers.take(event('session.error', { sessionID: CHILD, error: { name: 'APIError', data: { message: 'rate limited' } } }));

    expect(helpers.take(childIdle)).toEqual({ steps: [{ type: 'subagent_completed', id: 'call_1', text: '', error: 'rate limited' }], workChanged: true });
    expect(helpers.running()).toEqual([]);
  });

  it('keeps what a subagent did before the task call named its session, and shows it once named', () => {
    const helpers = new OpenCodeHelpers(() => PARENT);
    helpers.take(event('session.created', { sessionID: CHILD, info: { id: CHILD, parentID: PARENT } }));
    helpers.take(childText('prt_task', 'the task itself', false));
    helpers.take(childText('prt_1', 'Looking.'));

    expect(helpers.take(taskPart(true))).toEqual({ steps: [{ type: 'subagent_message', id: 'call_1', text: 'Looking.' }], workChanged: true });
  });

  it("ignores other conversations' sessions", () => {
    const helpers = new OpenCodeHelpers(() => PARENT);
    helpers.take(taskPart(true));

    expect(helpers.take(event('message.part.updated', { sessionID: 'ses_other', part: { type: 'text', id: 'x', text: 'hi', time: { end: 1 } } }))).toEqual({ steps: [], workChanged: false });
    expect(helpers.running()).toEqual([{ id: 'call_1', kind: 'agent', label: 'inspect' }]);
  });

  it('leaves the end of a subagent the turn waits for to its task call', () => {
    const helpers = new OpenCodeHelpers(() => PARENT);
    helpers.take(taskPart(false));

    expect(helpers.running()).toEqual([]);
    expect(helpers.take(childIdle).steps).toEqual([]);
  });

  it('names the background work OpenCode prompted the conversation about, and whether it failed', () => {
    const helpers = new OpenCodeHelpers(() => PARENT);
    helpers.take(taskPart(true));
    const result = event('message.part.updated', { sessionID: PARENT, part: { type: 'text', synthetic: true, text: `<task id="${CHILD}" state="error">\n<summary>Background task failed: inspect</summary></task>` } });

    expect(helpers.take(result).finished).toEqual({ workId: 'call_1', label: 'inspect', failed: true });
  });

  it('stops only background work that still runs', () => {
    const helpers = new OpenCodeHelpers(() => PARENT);
    helpers.take(taskPart(true));

    expect(helpers.stop('call_9')).toBeUndefined();
    expect(helpers.stop('call_1')).toBe(CHILD);
    expect(helpers.take(childIdle).steps).toEqual([{ type: 'subagent_completed', id: 'call_1', text: '', stopped: true }]);
    expect(helpers.stop('call_1')).toBeUndefined();
  });
});
