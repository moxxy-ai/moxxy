/**
 * What Claude's messages become in Moxxy. The messages are trimmed copies of
 * what Claude Code 2.1.296 sent through the Agent SDK in the spike.
 */
import { describe, expect, it } from 'vitest';
import type { ClaudeMessage } from './sdk-types.js';
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

  it('leaves the approval policy alone in plan mode, which says nothing about it', () => {
    expect(new TurnTranslator().translate(init('plan'))).toEqual([{ type: 'session', sessionId: 's-1' }]);
    expect(autoApproveFor('auto')).toBeUndefined();
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
    expect(t.translate(assistant([{ type: 'text', text: 'The output was `spike-ok`.' }]))).toEqual([
      { type: 'message', text: 'The output was `spike-ok`.', stopReason: 'end_turn' },
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

  it('leaves a subagent inner work out, except a result of a call it already showed', () => {
    const t = new TurnTranslator();

    expect(t.translate(assistant([{ type: 'tool_use', id: 'toolu_sub', name: 'Bash', input: {} }], 'toolu_agent'))).toEqual([]);
    expect(t.translate(toolResult('toolu_sub', '2', false, 'toolu_agent'))).toEqual([]);
    t.announce('toolu_sub2', 'Bash', {});
    expect(t.translate(toolResult('toolu_sub2', '3', false, 'toolu_agent'))).toEqual([
      { type: 'tool_result', callId: 'toolu_sub2', ok: true, output: '3' },
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
