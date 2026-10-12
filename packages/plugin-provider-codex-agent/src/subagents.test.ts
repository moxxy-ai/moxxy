/** Codex's subagents, shaped as Codex 0.155 reports them: activity items on the conversation's thread, the work on the subagent's own. */
import { describe, expect, it } from 'vitest';
import { CodexSubagents } from './subagents.js';

const CHILD = 'thread-child';
const activity = (kind: 'started' | 'completed') => ({ type: 'subAgentActivity', id: `act-${kind}`, kind, agentThreadId: CHILD, agentPath: '/root/inspect_folder' });
const onChild = (item: Record<string, unknown>) => ({ threadId: CHILD, turnId: 'turn-child', item });

describe("Codex's subagents", () => {
  it('start once, named after their path, however often Codex reports the start', () => {
    const subagents = new CodexSubagents();

    expect(subagents.activity(activity('started'))).toEqual([{ type: 'subagent_started', id: CHILD, label: 'inspect folder', agentType: 'subagent' }]);
    expect(subagents.activity(activity('started'))).toEqual([]);
  });

  it('show the tools a subagent runs in its own thread, and end with its answer and tokens', () => {
    const subagents = new CodexSubagents();
    subagents.activity(activity('started'));

    const ran = subagents.fromThread('item/completed', onChild({ type: 'commandExecution', id: 'exec-1', command: "/bin/zsh -lc 'ls -la'", cwd: '/repo', status: 'completed', aggregatedOutput: 'a.txt', exitCode: 0 }));
    subagents.fromThread('item/completed', onChild({ type: 'agentMessage', id: 'msg-1', text: 'Two files.', phase: 'final_answer' }));
    subagents.fromThread('thread/tokenUsage/updated', { threadId: CHILD, turnId: 'turn-child', tokenUsage: { total: { totalTokens: 47282 }, last: { totalTokens: 23747 } } });

    expect(ran).toEqual([{ type: 'subagent_tool_call', id: CHILD, name: 'Bash', input: { command: 'ls -la', cwd: '/repo' } }]);
    expect(subagents.activity(activity('completed'))).toEqual([{ type: 'subagent_completed', id: CHILD, text: 'Two files.', tokensUsed: 47282 }]);
    expect(subagents.activity(activity('completed'))).toEqual([]);
  });

  it('leave out threads that are not a subagent Codex announced', () => {
    const subagents = new CodexSubagents();

    expect(subagents.fromThread('item/completed', onChild({ type: 'commandExecution', id: 'exec-1', command: 'ls', cwd: '/repo', status: 'completed' }))).toEqual([]);
  });
});
