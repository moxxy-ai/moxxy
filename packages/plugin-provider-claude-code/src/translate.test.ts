/**
 * What Claude's messages become in Moxxy. The messages are trimmed copies of
 * what Claude Code 2.1.296 sent through the Agent SDK in the spike.
 */
import { describe, expect, it } from 'vitest';
import type { ClaudeMessage } from './sdk-types.js';
import { ClaudeSubagents } from './subagents.js';
import { ClaudeTaskList } from './task-list.js';
import { TurnTranslator, autoApproveFor, goalStatusFrom, toClaudeContent, toTokenUsage } from './translate.js';

const init = (permissionMode: string): ClaudeMessage =>
  ({ type: 'system', subtype: 'init', session_id: 's-1', permissionMode, model: 'claude-opus-5-5' }) as ClaudeMessage;
const assistant = (content: unknown[], parent: string | null = null, model = 'claude-opus-5-5'): ClaudeMessage =>
  ({ type: 'assistant', message: { model, content }, parent_tool_use_id: parent }) as ClaudeMessage;
const toolResult = (id: string, content: unknown, isError?: boolean, parent: string | null = null): ClaudeMessage =>
  ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
    parent_tool_use_id: parent,
  }) as ClaudeMessage;
/** The tool's own output object, which the SDK sends beside the text the model reads. */
const withToolUseResult = (message: ClaudeMessage, result: unknown): ClaudeMessage => ({ ...message, tool_use_result: result }) as ClaudeMessage;

describe('Claude messages as Moxxy events', () => {
  it('records the session and the real approval policy from the start of each turn', () => {
    const t = new TurnTranslator();

    expect(t.translate(init('default'))).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'auto_approve', enabled: false },
    ]);
    expect(t.translate(init('bypassPermissions'))).toContainEqual({ type: 'auto_approve', enabled: true });
  });

  it('says how full its context is from the usage of its last call, not that of a helper agent', () => {
    const t = new TurnTranslator();
    const withUsage = (message: ClaudeMessage, usage: Record<string, number>): ClaudeMessage =>
      ({ ...message, message: { ...(message as { message: object }).message, usage } }) as ClaudeMessage;

    const main = t.translate(withUsage(assistant([{ type: 'text', text: 'Reading.' }]), { input_tokens: 2_000, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 500, output_tokens: 40 }));
    const helper = t.translate(withUsage(assistant([{ type: 'text', text: 'Found it.' }], 'toolu_task'), { input_tokens: 9_000, output_tokens: 10 }));

    expect(main).toContainEqual({ type: 'context_used', tokens: 152_500 });
    expect(helper.filter((e) => e.type === 'context_used')).toEqual([]);
  });

  it('leaves the approval policy alone in plan mode, which says nothing about it', () => {
    expect(new TurnTranslator().translate(init('plan'))).toEqual([{ type: 'session', sessionId: 's-1' }]);
    expect(autoApproveFor('auto')).toBeUndefined();
  });

  it('follows a change of permission mode Claude reports in the middle of a session', () => {
    const t = new TurnTranslator();
    const status = (permissionMode?: string): ClaudeMessage =>
      ({ type: 'system', subtype: 'status', status: null, session_id: 's-1', ...(permissionMode ? { permissionMode } : {}) }) as ClaudeMessage;

    expect(t.translate(status('default'))).toEqual([{ type: 'auto_approve', enabled: false }]);
    expect(t.translate(status('bypassPermissions'))).toEqual([{ type: 'auto_approve', enabled: true }]);
    expect(t.translate(status('plan'))).toEqual([]);
    expect(t.translate(status())).toEqual([]);
  });

  it('streams text and thinking as it comes', () => {
    const t = new TurnTranslator();
    const delta = (d: unknown) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: d }, parent_tool_use_id: null }) as ClaudeMessage;

    expect(t.translate(delta({ type: 'text_delta', text: 'ZEB' }))).toEqual([{ type: 'text_delta', delta: 'ZEB' }]);
    expect(t.translate(delta({ type: 'thinking_delta', thinking: 'hm' }))).toEqual([{ type: 'reasoning_delta', delta: 'hm' }]);
    expect(t.translate(delta({ type: 'signature_delta' }))).toEqual([]);
  });

  it('turns a finished message into a Moxxy message, and a call into a tool call with its result', () => {
    expect(
      new TurnTranslator().translate(assistant([{ type: 'text', text: 'Reading it.' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }])),
    ).toEqual([
      { type: 'message', text: 'Reading it.', stopReason: 'tool_use' },
      { type: 'tool_call', callId: 't', name: 'Read', input: {} },
    ]);

    const t = new TurnTranslator();

    expect(t.translate(assistant([{ type: 'thinking', thinking: '' }]))).toEqual([]);
    expect(
      t.translate(assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo spike-ok' } }])),
    ).toEqual([{ type: 'tool_call', callId: 'toolu_1', name: 'Bash', input: { command: 'echo spike-ok' } }]);
    expect(t.translate(toolResult('toolu_1', 'spike-ok', false))).toEqual([
      { type: 'tool_result', callId: 'toolu_1', ok: true, output: 'spike-ok' },
    ]);
    // A sentence on its own may still be followed by a call: it is marked once the turn ends.
    expect(t.translate(assistant([{ type: 'text', text: 'The output was `spike-ok`.' }]))).toEqual([]);
    expect(t.finish()).toEqual([{ type: 'message', text: 'The output was `spike-ok`.', stopReason: 'end_turn' }]);
    expect(t.finish()).toEqual([]);
  });

  // Claude Code sends each block of a reply as a message of its own, with no stop reason
  // yet: a sentence and the call after it arrive apart (seen live with Claude Code 2.1.311).
  it('marks a sentence Claude sends apart from the call after it as part of the work', () => {
    const t = new TurnTranslator();

    expect(t.translate(assistant([{ type: 'text', text: 'Building the package.' }]))).toEqual([]);
    expect(t.translate(assistant([{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'pnpm build' } }]))).toEqual([
      { type: 'message', text: 'Building the package.', stopReason: 'tool_use' },
      { type: 'tool_call', callId: 'toolu_b', name: 'Bash', input: { command: 'pnpm build' } },
    ]);
  });

  it('marks a sentence by how Claude says its reply stopped', () => {
    const t = new TurnTranslator();
    const stopped = (stopReason: string): ClaudeMessage =>
      ({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: stopReason } }, parent_tool_use_id: null }) as ClaudeMessage;

    t.translate(assistant([{ type: 'text', text: 'Checking.' }]));
    expect(t.translate(stopped('tool_use'))).toEqual([{ type: 'message', text: 'Checking.', stopReason: 'tool_use' }]);
    t.translate(assistant([{ type: 'text', text: 'Done.' }]));
    expect(t.translate(stopped('end_turn'))).toEqual([{ type: 'message', text: 'Done.', stopReason: 'end_turn' }]);
    expect(t.translate(stopped('end_turn'))).toEqual([]);
  });

  it('marks a sentence before a call the approval asked about first as part of the work', () => {
    const t = new TurnTranslator();

    t.translate(assistant([{ type: 'text', text: 'Editing it.' }]));
    expect(t.announce('toolu_e', 'Edit', { file_path: 'a.ts' })).toEqual([
      { type: 'message', text: 'Editing it.', stopReason: 'tool_use' },
      { type: 'tool_call', callId: 'toolu_e', name: 'Edit', input: { file_path: 'a.ts' } },
    ]);
  });

  it('keeps a refused or failed call as a failure with what Claude was told', () => {
    const t = new TurnTranslator();
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} }]));

    expect(t.translate(toolResult('toolu_2', 'PreToolUse:Bash hook error: Blocked by a rule', true))).toEqual([
      { type: 'tool_result', callId: 'toolu_2', ok: false, error: 'PreToolUse:Bash hook error: Blocked by a rule' },
    ]);
  });

  it('reads a result made of text blocks', () => {
    const t = new TurnTranslator();
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_3', name: 'WebFetch', input: {} }]));

    expect(t.translate(toolResult('toolu_3', [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))).toEqual([
      { type: 'tool_result', callId: 'toolu_3', ok: true, output: 'a\nb' },
    ]);
  });

  it('shows no call to a Moxxy tool: Moxxy records those itself when it runs them', () => {
    const t = new TurnTranslator();

    expect(t.translate(assistant([{ type: 'tool_use', id: 'toolu_4', name: 'mcp__moxxy__browser_navigate', input: {} }]))).toEqual([]);
    expect(t.translate(toolResult('toolu_4', [{ type: 'text', text: 'ok' }]))).toEqual([]);
  });

  it('announces a call once, even when the approval asked about it first', () => {
    const t = new TurnTranslator();

    expect(t.announce('toolu_5', 'Edit', { file_path: 'a.ts' })).toEqual([
      { type: 'tool_call', callId: 'toolu_5', name: 'Edit', input: { file_path: 'a.ts' } },
    ]);
    expect(t.translate(assistant([{ type: 'tool_use', id: 'toolu_5', name: 'Edit', input: { file_path: 'a.ts' } }]))).toEqual([]);
    expect(t.announce('toolu_5', 'Edit', {})).toEqual([]);
  });

  it('shows an edit and a new file as diffs from what Claude reports, with the path inside the project', () => {
    const t = new TurnTranslator('/repo');
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: '/repo/src/db.ts' } }]));
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_w', name: 'Write', input: { file_path: '/repo/notes.md' } }]));
    const edited = {
      filePath: '/repo/src/db.ts',
      oldString: 'const port = 5432;',
      newString: 'const port = 5433;',
      originalFile: 'const host = "x";\nconst port = 5432;\n',
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' const host = "x";', '-const port = 5432;', '+const port = 5433;'] }],
      userModified: false,
      replaceAll: false,
    };
    const created = { type: 'create', filePath: '/repo/notes.md', content: '# Notes\nport 5433\n', structuredPatch: [], originalFile: null, userModified: false };

    const [edit] = t.translate(withToolUseResult(toolResult('toolu_e', 'The file /repo/src/db.ts has been updated successfully.'), edited));
    const [write] = t.translate(withToolUseResult(toolResult('toolu_w', 'File created successfully at: /repo/notes.md'), created));

    expect(edit).toMatchObject({
      type: 'tool_result',
      ok: true,
      output: {
        forModel: 'The file /repo/src/db.ts has been updated successfully.',
        display: { kind: 'file-diff', path: 'src/db.ts', mode: 'update', added: 1, removed: 1 },
      },
    });
    expect(write).toMatchObject({ output: { display: { kind: 'file-diff', path: 'notes.md', mode: 'create', added: 2, removed: 0 } } });
  });

  it('keeps the image a result carries, such as a screenshot Claude looks at, with the text beside it', () => {
    const t = new TurnTranslator('/repo');
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_s', name: 'mcp__computer-use__screenshot', input: {} }]));
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } };

    expect(t.translate(toolResult('toolu_s', [{ type: 'text', text: 'Screen 1440x900' }, image, image]))).toEqual([
      { type: 'tool_result', callId: 'toolu_s', ok: true, output: { forModel: 'Screen 1440x900', mediaType: 'image/png', base64: 'iVBORw0K' } },
    ]);
  });

  it('keeps every different image a result carries, in order', () => {
    const t = new TurnTranslator('/repo');
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_m', name: 'mcp__computer-use__computer_batch', input: {} }]));
    const image = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });

    expect(t.translate(toolResult('toolu_m', [{ type: 'text', text: 'Two screens' }, image('ONE'), image('TWO')]))).toEqual([
      {
        type: 'tool_result',
        callId: 'toolu_m',
        ok: true,
        output: { forModel: 'Two screens', mediaType: 'image/png', base64: 'ONE', moreImages: [{ mediaType: 'image/png', base64: 'TWO' }] },
      },
    ]);
  });

  it('keeps the text of a result whose report is no file change', () => {
    const t = new TurnTranslator('/repo');
    t.translate(assistant([{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: {} }]));

    expect(t.translate(withToolUseResult(toolResult('toolu_b', 'ok'), { stdout: 'ok', stderr: '' }))).toEqual([
      { type: 'tool_result', callId: 'toolu_b', ok: true, output: 'ok' },
    ]);
  });

});

describe("Claude's subagents", () => {
  const launch = (id = 'toolu_agent') =>
    assistant([{ type: 'tool_use', id, name: 'Agent', input: { description: 'List files', prompt: 'list the files', subagent_type: 'Explore' } }]);
  const system = (fields: Record<string, unknown>): ClaudeMessage => ({ type: 'system', ...fields }) as ClaudeMessage;

  it('show a subagent Claude starts as a subagent, not as a tool call', () => {
    const t = new TurnTranslator();

    expect(t.translate(launch())).toEqual([{ type: 'subagent_started', id: 'toolu_agent', label: 'List files', agentType: 'Explore', prompt: 'list the files' }]);
    expect(t.announce('toolu_agent', 'Agent', {})).toEqual([]);
  });

  it("show the subagent's tools under it, once, and keep their results out of the conversation", () => {
    const t = new TurnTranslator();
    t.translate(launch());

    expect(t.translate(assistant([{ type: 'tool_use', id: 'toolu_sub', name: 'Bash', input: { command: 'ls' } }], 'toolu_agent'))).toEqual([
      { type: 'subagent_tool_call', id: 'toolu_agent', name: 'Bash', input: { command: 'ls' } },
    ]);
    // Moxxy's rules are checked for a subagent's call too; that shows nothing more.
    expect(t.announce('toolu_sub', 'Bash', { command: 'ls' })).toEqual([]);
    expect(t.translate(toolResult('toolu_sub', 'a.txt', false, 'toolu_agent'))).toEqual([]);
  });

  it("show nothing in the main conversation for a subagent's call Moxxy checks before its message arrives", () => {
    const t = new TurnTranslator();
    t.translate(launch());

    expect(t.announce('toolu_sub', 'Bash', { command: 'ls' }, { inSubagent: true })).toEqual([]);
    expect(t.translate(assistant([{ type: 'tool_use', id: 'toolu_sub', name: 'Bash', input: { command: 'ls' } }], 'toolu_agent'))).toEqual([
      { type: 'subagent_tool_call', id: 'toolu_agent', name: 'Bash', input: { command: 'ls' } },
    ]);
  });

  it('end a subagent Claude waited for with its answer and tokens', () => {
    const t = new TurnTranslator();
    t.translate(launch());

    const done = withToolUseResult(toolResult('toolu_agent', [{ type: 'text', text: 'Two files.' }]), { status: 'completed', totalTokens: 1200 });

    expect(t.translate(done)).toEqual([{ type: 'subagent_completed', id: 'toolu_agent', text: 'Two files.', tokensUsed: 1200 }]);
  });

  it("end a subagent Claude waited for with its own report, not Claude's hand-back wrapping, even after its task note", () => {
    const t = new TurnTranslator();
    t.translate(launch());
    t.translate(system({ subtype: 'task_progress', tool_use_id: 'toolu_agent', usage: { total_tokens: 13883 } }));

    expect(t.translate(system({ subtype: 'task_notification', tool_use_id: 'toolu_agent', status: 'completed', summary: 'Two files.' }))).toEqual([]);

    const wrapped = '[Subagent hand-back] The text below is the final report… The report follows:\n  Two files.\nagentId: a1 (use SendMessage…)\n<usage>subagent_tokens: 15846</usage>';
    const done = withToolUseResult(toolResult('toolu_agent', [{ type: 'text', text: wrapped }]), { status: 'completed', content: [{ type: 'text', text: 'Two files.' }] });
    expect(t.translate(done)).toEqual([{ type: 'subagent_completed', id: 'toolu_agent', text: 'Two files.', tokensUsed: 13883 }]);
  });

  it('end a subagent running in the background when Claude reports its task finished, with its last words', () => {
    const subagents = new ClaudeSubagents();
    const first = new TurnTranslator('', new ClaudeTaskList(), subagents);
    first.translate(launch());
    expect(first.translate(withToolUseResult(toolResult('toolu_agent', 'Async agent launched'), { isAsync: true, status: 'async_launched' }))).toEqual([]);
    first.translate(assistant([{ type: 'text', text: 'Two files: a.txt, notes.txt.' }], 'toolu_agent'));

    const later = new TurnTranslator('', new ClaudeTaskList(), subagents);
    later.translate(system({ subtype: 'task_progress', tool_use_id: 'toolu_agent', usage: { total_tokens: 15199 } }));

    expect(later.translate(system({ subtype: 'task_notification', tool_use_id: 'toolu_agent', status: 'completed' }))).toEqual([
      { type: 'subagent_completed', id: 'toolu_agent', text: 'Two files: a.txt, notes.txt.', tokensUsed: 15199 },
    ]);
    expect(later.translate(system({ subtype: 'task_notification', tool_use_id: 'toolu_agent', status: 'completed' }))).toEqual([]);
  });

  it("end a subagent running in the background with Claude's summary when it said nothing more", () => {
    const t = new TurnTranslator();
    t.translate(launch());
    t.translate(withToolUseResult(toolResult('toolu_agent', 'Async agent launched'), { isAsync: true, status: 'async_launched' }));

    expect(t.translate(system({ subtype: 'task_notification', tool_use_id: 'toolu_agent', status: 'completed', summary: 'Two files.' }))).toEqual([
      { type: 'subagent_completed', id: 'toolu_agent', text: 'Two files.' },
    ]);
  });

  it('end a background subagent that failed with the reason', () => {
    const t = new TurnTranslator();
    t.translate(launch());
    t.translate(withToolUseResult(toolResult('toolu_agent', 'Async agent launched'), { isAsync: true, status: 'async_launched' }));

    expect(t.translate(system({ subtype: 'task_notification', tool_use_id: 'toolu_agent', status: 'failed', summary: 'It hit the limit.' }))).toEqual([
      { type: 'subagent_completed', id: 'toolu_agent', text: '', error: 'It hit the limit.' },
    ]);
  });
});

describe('reading Claude results', () => {
  it('counts tokens the way Moxxy does', () => {
    expect(
      toTokenUsage({ input_tokens: 4, output_tokens: 97, cache_read_input_tokens: 84366, cache_creation_input_tokens: 8148 }),
    ).toEqual({ inputTokens: 4, outputTokens: 97, cacheReadTokens: 84366, cacheCreationTokens: 8148 });
  });

  it('tells an open goal from a met one by what `/goal` answers', () => {
    expect(goalStatusFrom('Goal active: count.txt lists 1 to 400 (not yet evaluated)')).toBe('active');
    expect(goalStatusFrom('No goal set. Usage: `/goal <condition>`')).toBe('complete');
    expect(goalStatusFrom('Something else')).toBeUndefined();
  });
});

describe('the person message for Claude', () => {
  it('passes text, pictures and documents as Messages API blocks', () => {
    expect(
      toClaudeContent([
        { type: 'text', text: 'What colours?' },
        { type: 'image', mediaType: 'image/png', data: 'AAA' },
        { type: 'document', mediaType: 'application/pdf', data: 'BBB' },
      ]),
    ).toEqual([
      { type: 'text', text: 'What colours?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' } },
    ]);
  });

  it('starts the agent own goal with `/goal` in front of the text', () => {
    expect(toClaudeContent([{ type: 'text', text: 'make goal.txt' }], '/goal ')).toEqual([{ type: 'text', text: '/goal make goal.txt' }]);
  });
});

describe("Claude's list of steps", () => {
  const call = (t: TurnTranslator, id: string, name: string, input: unknown) => t.translate(assistant([{ type: 'tool_use', id, name, input }]));
  const finish = (t: TurnTranslator, id: string, text: string, result: unknown) => t.translate(withToolUseResult(toolResult(id, text), result));
  const stepsOf = (events: ReturnType<TurnTranslator['translate']>) => (events[0] as { output: { display: { steps: unknown } } }).output.display.steps;

  // As Claude Code 2.1.296 with claude-haiku-4-5 sent them, live.
  it('follows the tasks Claude creates and updates one at a time, as a whole list after each call', () => {
    const t = new TurnTranslator('/repo');
    call(t, 'c1', 'TaskCreate', { subject: "Create a.txt containing 'a'", description: 'Write file a.txt' });
    call(t, 'c2', 'TaskCreate', { subject: "Create b.txt containing 'b'", description: 'Write file b.txt' });
    finish(t, 'c1', "Task #1 created successfully: Create a.txt containing 'a'", { task: { id: '1', subject: "Create a.txt containing 'a'" } });
    const created = finish(t, 'c2', "Task #2 created successfully: Create b.txt containing 'b'", { task: { id: '2', subject: "Create b.txt containing 'b'" } });
    call(t, 'u1', 'TaskUpdate', { taskId: '1', status: 'completed' });

    const updated = finish(t, 'u1', 'Updated task #1 status', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } });

    expect(stepsOf(created)).toEqual([
      { text: "Create a.txt containing 'a'", status: 'pending' },
      { text: "Create b.txt containing 'b'", status: 'pending' },
    ]);
    expect(updated).toEqual([
      {
        type: 'tool_result',
        callId: 'u1',
        ok: true,
        output: {
          forModel: 'Updated task #1 status',
          display: {
            kind: 'step-list',
            steps: [
              { text: "Create a.txt containing 'a'", status: 'completed' },
              { text: "Create b.txt containing 'b'", status: 'pending' },
            ],
          },
        },
      },
    ]);
  });

  it('keeps the list across turns, drops a deleted task, and takes TaskList as the whole list', () => {
    const tasks = new ClaudeTaskList();
    const first = new TurnTranslator('/repo', tasks);
    call(first, 'c1', 'TaskCreate', { subject: 'One' });
    finish(first, 'c1', 'Task #1 created', { task: { id: '1', subject: 'One' } });
    call(first, 'c2', 'TaskCreate', { subject: 'Two' });
    finish(first, 'c2', 'Task #2 created', { task: { id: '2', subject: 'Two' } });

    const next = new TurnTranslator('/repo', tasks);
    call(next, 'u2', 'TaskUpdate', { taskId: '2', status: 'deleted' });
    expect(stepsOf(finish(next, 'u2', 'Updated task #2', { success: true, taskId: '2' }))).toEqual([{ text: 'One', status: 'pending' }]);
    call(next, 'l1', 'TaskList', {});
    const listed = finish(next, 'l1', '#1 [in_progress] One\n#3 [pending] Three', {
      tasks: [
        { id: '1', subject: 'One', status: 'in_progress' },
        { id: '3', subject: 'Three', status: 'pending' },
      ],
    });
    expect(stepsOf(listed)).toEqual([
      { text: 'One', status: 'in_progress' },
      { text: 'Three', status: 'pending' },
    ]);
  });

  it('leaves the text of an update to a task it never saw created, as after Moxxy started a new Claude', () => {
    const t = new TurnTranslator('/repo');
    call(t, 'u9', 'TaskUpdate', { taskId: '9', status: 'completed' });

    expect(finish(t, 'u9', 'Updated task #9 status', { success: true, taskId: '9' })).toEqual([{ type: 'tool_result', callId: 'u9', ok: true, output: 'Updated task #9 status' }]);
  });

  it('reads an older Claude TodoWrite list from what it wrote', () => {
    const t = new TurnTranslator('/repo');
    call(t, 'w1', 'TodoWrite', {
      todos: [
        { content: 'Create a.txt', status: 'completed', activeForm: 'Creating a.txt' },
        { content: 'Create b.txt', status: 'in_progress', activeForm: 'Creating b.txt' },
      ],
    });

    expect(stepsOf(finish(t, 'w1', 'Todos have been modified successfully.', { oldTodos: [], newTodos: [] }))).toEqual([
      { text: 'Create a.txt', status: 'completed' },
      { text: 'Create b.txt', status: 'in_progress' },
    ]);
  });
});

describe("Claude's account limit", () => {
  /** As Claude Code 2.1.296 sent it on a Pro plan with 92% of the week used. */
  const rateLimit = (info: Record<string, unknown>): ClaudeMessage => ({ type: 'rate_limit_event', rate_limit_info: info, session_id: 's-1' }) as unknown as ClaudeMessage;
  const week = { rateLimitType: 'seven_day', resetsAt: 1792216800, utilization: 0.92, overageStatus: 'rejected', isUsingOverage: false };

  it('reads how much of the window is used and when it resets', () => {
    const t = new TurnTranslator();
    expect(t.translate(rateLimit({ status: 'allowed_warning', ...week }))).toEqual([
      { type: 'account_limit', limit: { state: 'near', resetsAt: 1792216800_000, windowMinutes: 10080, usedPercent: 92 } },
    ]);
    expect(t.translate(rateLimit({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1791822600, utilization: 0.4 }))).toEqual([
      { type: 'account_limit', limit: { state: 'ok', resetsAt: 1791822600_000, windowMinutes: 300, usedPercent: 40 } },
    ]);
  });

  it('counts a used-up window as reached unless Claude goes on with extra usage', () => {
    expect(new TurnTranslator().translate(rateLimit({ status: 'rejected', ...week, utilization: 1 }))).toEqual([
      { type: 'account_limit', limit: { state: 'reached', resetsAt: 1792216800_000, windowMinutes: 10080, usedPercent: 100 } },
    ]);
    const extra = new TurnTranslator().translate(rateLimit({ status: 'rejected', ...week, utilization: 1, overageStatus: 'allowed', isUsingOverage: true }));
    expect(extra).toEqual([{ type: 'account_limit', limit: expect.objectContaining({ state: 'near' }) }]);
  });

  it("shows Claude's own limit message as the reached limit, with the reset Claude reported, not as its answer", () => {
    const t = new TurnTranslator();
    t.translate(rateLimit({ status: 'rejected', ...week, utilization: 1 }));
    const limitMessage = { ...(assistant([{ type: 'text', text: "You've hit your limit · resets Oct 18, 6pm" }], null, '<synthetic>') as object), error: 'rate_limit' } as unknown as ClaudeMessage;

    expect(t.translate(limitMessage)).toEqual([
      { type: 'account_limit', limit: { state: 'reached', resetsAt: 1792216800_000, windowMinutes: 10080, usedPercent: 100 } },
    ]);
    expect(new TurnTranslator().translate(limitMessage)).toEqual([{ type: 'account_limit', limit: { state: 'reached' } }]);
  });
});
