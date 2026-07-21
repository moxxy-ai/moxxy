import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import {
  CLAUDE_CODE_DEFAULT_MODEL,
  claudeCodeModels,
  claudeCodeProviderDef,
  createClaudeCodeClient,
} from './index.js';

class ControlledProviderChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal);
    this.signalCode = signal;
    this.emit('close', null, signal);
    return true;
  }

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('claude-code provider definition', () => {
  it('registers the exact Claude Code catalog, default, and text-only capabilities', () => {
    expect(claudeCodeProviderDef.name).toBe('claude-code');
    expect(claudeCodeProviderDef.auth?.kind).toBe('oauth');
    expect(CLAUDE_CODE_DEFAULT_MODEL).toBe('claude-sonnet-4-6');
    expect(claudeCodeProviderDef.models).toBe(claudeCodeModels);
    expect(claudeCodeProviderDef.models.map((model) => model.id)).toEqual([
      'claude-sonnet-4-6',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    for (const model of claudeCodeProviderDef.models) {
      expect(model).toMatchObject({
        supportsStreaming: true,
        supportsTools: false,
        supportsImages: false,
        supportsDocuments: false,
        supportsAudio: false,
        supportsReasoning: false,
      });
    }
  });

  it('streams text through a fake Claude executable with structured non-interactive arguments', async () => {
    const dir = await makeFakeClaude([
      { type: 'system', subtype: 'init' },
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } },
      { type: 'stream_event', event: { type: 'message_start', message: {} } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } } },
      { type: 'stream_event', event: { type: 'message_stop' } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Hello world', usage: { input_tokens: 8, output_tokens: 2 } },
    ]);
    const client = createClaudeCodeClient({ executable: join(dir, 'claude') });
    const events = await collect(client.stream(textRequest()));

    expect(events).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4-6' },
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 2 } },
    ]);
    const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--tools', '',
    ]));
    const input = await readFile(join(dir, 'input.txt'), 'utf8');
    expect(input).toContain('system instructions');
    expect(input).toContain('<user>\nprior user');
    expect(input).toContain('<assistant>\nprior assistant');
    expect(input).toContain('<user>\nlatest user');
    expect(input).not.toContain('oauth-secret');
  });

  it('consumes streamed thinking blocks without exposing their deltas', async () => {
    const dir = await makeFakeClaude([
      { type: 'stream_event', event: { type: 'message_start', message: {} } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private chain of thought' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'private-signature' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Visible answer' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Visible answer', usage: { input_tokens: 3, output_tokens: 2 } },
    ]);
    const events = await collect(createClaudeCodeClient({ executable: join(dir, 'claude') }).stream(textRequest()));

    expect(events).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4-6' },
      { type: 'text_delta', delta: 'Visible answer' },
      { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    expect(JSON.stringify(events)).not.toContain('private chain of thought');
    expect(JSON.stringify(events)).not.toContain('private-signature');
  });

  it('accepts complete assistant records containing thinking blocks without exposing them', async () => {
    const dir = await makeFakeClaude([
      { type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'private chain of thought', signature: 'private-signature' },
        { type: 'text', text: 'Visible answer' },
      ] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Visible answer', usage: { input_tokens: 3, output_tokens: 2 } },
    ]);
    const events = await collect(createClaudeCodeClient({ executable: join(dir, 'claude') }).stream(textRequest()));

    expect(events).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4-6' },
      { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    expect(JSON.stringify(events)).not.toContain('private chain of thought');
    expect(JSON.stringify(events)).not.toContain('private-signature');
  });

  it('reconstructs two turns for each stateless CLI invocation without a session id', async () => {
    const dir = await makeFakeClaude([
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'first answer' } } },
      { type: 'result', subtype: 'success', is_error: false, result: 'first answer', usage: { input_tokens: 2, output_tokens: 2 } },
    ]);
    const client = createClaudeCodeClient({ executable: join(dir, 'claude') });

    await collect(client.stream({
      model: CLAUDE_CODE_DEFAULT_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'first prompt' }] }],
    }));
    const firstInput = await readFile(join(dir, 'input.txt'), 'utf8');
    expect(firstInput).toContain('<user>\nfirst prompt\n</user>');

    await collect(client.stream({
      model: CLAUDE_CODE_DEFAULT_MODEL,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first prompt' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
      ],
    }));
    const secondInput = await readFile(join(dir, 'input.txt'), 'utf8');
    expect(secondInput.indexOf('first prompt')).toBeLessThan(secondInput.indexOf('first answer'));
    expect(secondInput.indexOf('first answer')).toBeLessThan(secondInput.indexOf('follow up'));
    const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8')) as string[];
    expect(args.some((arg) => /session|resume/i.test(arg))).toBe(false);
  });

  it('projects prior moxxy tools and unsafe content deterministically as inert text', async () => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const client = createClaudeCodeClient({ executable: join(dir, 'claude') });
    const rawBase64 = 'U0VDUkVUX0JJTkFSWV9QQVlMT0FE';
    const request: ProviderRequest = {
      model: CLAUDE_CODE_DEFAULT_MODEL,
      messages: [
        { role: 'assistant', content: [
          { type: 'reasoning', text: 'private chain', signature: 'signed-secret' },
          { type: 'tool_use', id: 'call-1', name: 'Read', input: { z: 2, a: 1 } },
        ] },
        { role: 'tool_result', content: [
          { type: 'tool_result', toolUseId: 'call-1', content: 'file contents' },
        ] },
        { role: 'user', content: [
          { type: 'image', mediaType: 'image/png', data: rawBase64 },
          { type: 'text', text: '' },
        ] },
      ],
    };

    await collect(client.stream(request));
    const first = await readFile(join(dir, 'input.txt'), 'utf8');
    await collect(client.stream(request));
    const replay = await readFile(join(dir, 'input.txt'), 'utf8');

    expect(replay).toBe(first);
    expect(first).toContain('<historical_tool_use status="already_executed_do_not_repeat">');
    expect(first).toContain('<input_json>{&quot;a&quot;:1,&quot;z&quot;:2}</input_json>');
    expect(first).toContain('<historical_tool_result tool_use_id="call-1" status="success">');
    expect(first).toContain('[reasoning omitted: private reasoning and signatures are not replayed]');
    expect(first).toContain('[image attachment omitted: mediaType=image/png; binary data not included]');
    expect(first).toContain('[empty text block omitted]');
    expect(first).not.toContain('private chain');
    expect(first).not.toContain('signed-secret');
    expect(first).not.toContain(rawBase64);
  });

  it('runs native tools in the configured workspace without emitting dispatcher tool events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'moxxy-claude-workspace-'));
    tempDirs.push(workspace);
    const dir = await makeFakeClaude([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-1', name: 'Write', input: { file_path: 'done.txt' } }] } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'edit-1', name: 'Write' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }] } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Edited.' } } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Edited.', usage: { input_tokens: 4, output_tokens: 1 } },
    ], { path: 'done.txt', content: 'edited by native tool\n' });
    const client = createClaudeCodeClient({
      executable: join(dir, 'claude'),
      mode: 'native-tools',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read', 'Write'],
      cwd: workspace,
    });
    const events = await collect(client.stream(textRequest()));

    expect(events.filter((event) => event.type.startsWith('tool_use'))).toEqual([]);
    expect(events.filter((event) => event.type === 'message_end')).toHaveLength(1);
    expect(events).toContainEqual({ type: 'text_delta', delta: 'Edited.' });
    expect(await readFile(join(dir, 'cwd.txt'), 'utf8')).toBe(await realpath(workspace));
    expect(await readFile(join(workspace, 'done.txt'), 'utf8')).toBe('edited by native tool\n');
    const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--tools', 'Read', 'Write', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read', 'Write',
    ]));
    expect(args).not.toContain('bypassPermissions');
    expect(args).not.toEqual(expect.arrayContaining(['--tools', '']));
  });

  it('leaves the safe permission default to Claude and uses a valid no-tools invocation for an empty native allow-list', async () => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    await collect(createClaudeCodeClient({
      executable: join(dir, 'claude'),
      mode: 'native-tools',
      allowedTools: [],
    }).stream(textRequest()));

    const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining(['--tools', '']));
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('bypassPermissions');
  });

  it.each(['claude-fable-5', 'claude-opus-4-8'])('passes the selected %s model as an exact structured argument', async (model) => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const client = createClaudeCodeClient({ executable: join(dir, 'claude') });
    await collect(client.stream({ ...textRequest(), model }));

    const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8')) as string[];
    expect(args.slice(-2)).toEqual(['--model', model]);
    expect(args.filter((arg) => arg === '--model')).toHaveLength(1);
  });

  it('uses the persisted provider-item model as its default selection', async () => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const client = claudeCodeProviderDef.createClient({ model: 'claude-fable-5', executable: join(dir, 'claude') });
    await collect(client.stream({ ...textRequest(), model: '' }));

    const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8')) as string[];
    expect(args.slice(-2)).toEqual(['--model', 'claude-fable-5']);
  });

  it('returns actionable errors for locally unsupported and CLI-rejected models', async () => {
    const supported = claudeCodeModels.map((model) => model.id);
    const unsupported = await collect(createClaudeCodeClient({
      spawn: () => { throw new Error('should not spawn'); },
    }).stream({ ...textRequest(), model: 'claude-imaginary-9' }));
    expect(unsupported[1]).toMatchObject({
      type: 'error',
      message: expect.stringContaining('claude-imaginary-9'),
      retryable: false,
    });
    for (const model of supported) expect((unsupported[1] as { message: string }).message).toContain(model);

    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Model is unavailable' },
    ]);
    const rejected = await collect(createClaudeCodeClient({ executable: join(dir, 'claude') }).stream({
      ...textRequest(),
      model: 'claude-fable-5',
    }));
    expect(rejected[1]).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/Claude Code rejected model "claude-fable-5".*Model is unavailable/),
      retryable: false,
    });
    for (const model of supported) expect((rejected[1] as { message: string }).message).toContain(model);
  });

  it.each([
    ['Not logged in. Authentication required', /signed out|authentication/i, false],
    ['Rate limit exceeded (429)', /service failure.*rate limit/i, true],
    ['Service temporarily unavailable', /service failure.*unavailable/i, true],
  ] as const)('classifies CLI failure %s', async (detail, message, retryable) => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: detail },
    ]);
    const events = await collect(createClaudeCodeClient({ executable: join(dir, 'claude') }).stream(textRequest()));
    expect(events[1]).toMatchObject({ type: 'error', message: expect.stringMatching(message), retryable });
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('emits exactly one non-retryable error when a request is cancelled', async () => {
    const child = new ControlledProviderChild();
    const controller = new AbortController();
    const eventsPromise = collect(createClaudeCodeClient({ spawn: () => child.asChild() }).stream({
      ...textRequest(),
      signal: controller.signal,
    }));
    controller.abort();
    const events = await eventsPromise;
    expect(events.filter((event) => event.type === 'error')).toEqual([{
      type: 'error',
      message: 'Claude CLI request aborted',
      retryable: false,
    }]);
    expect(child.kills).toEqual(['SIGTERM']);
  });

  it('reports a missing executable and an unexpected exit as actionable non-retryable errors', async () => {
    const missing = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const missingEvents = await collect(createClaudeCodeClient({
      executable: '/missing/claude',
      spawn: () => { throw missing; },
    }).stream(textRequest()));
    expect(missingEvents[1]).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/executable not found.*npm install/i),
      retryable: false,
    });

    const dir = await makeFailingClaude('unexpected local failure', 9);
    const exitEvents = await collect(createClaudeCodeClient({ executable: join(dir, 'claude') }).stream(textRequest()));
    expect(exitEvents[1]).toMatchObject({
      type: 'error',
      message: expect.stringContaining('unexpected local failure'),
      retryable: false,
    });
    expect(exitEvents.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('surfaces a permission denial as a clear non-retryable error', async () => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Permission denied for Edit' },
    ]);
    const events = await collect(createClaudeCodeClient({
      executable: join(dir, 'claude'),
      mode: 'native-tools',
      allowedTools: ['Read'],
    }).stream(textRequest()));
    expect(events[1]).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/Claude Code permission denied.*Edit/i),
      retryable: false,
    });
    expect(events.some((event) => event.type === 'message_end')).toBe(false);
  });

  it('does not inject a moxxy-managed Claude token into the child environment', async () => {
    let childEnv: NodeJS.ProcessEnv | undefined;
    const prior = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const client = createClaudeCodeClient({
      executable: join(dir, 'claude'),
      spawn: (file, args, options) => {
        childEnv = options.env;
        return spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'], env: options.env, cwd: options.cwd });
      },
    });
    try {
      await collect(client.stream(textRequest()));
      expect(childEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = prior;
    }
  });

  it('orders the identity, message-derived system text, and extra system text', async () => {
    const dir = await makeFakeClaude([
      { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const client = createClaudeCodeClient({ executable: join(dir, 'claude') });
    const base = textRequest();
    const request: ProviderRequest = {
      ...base,
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'message system' }] },
        ...base.messages,
      ],
    };
    await collect(client.stream(request));
    const input = await readFile(join(dir, 'input.txt'), 'utf8');
    expect(input.indexOf("You are Claude Code")).toBeLessThan(input.indexOf('message system'));
    expect(input.indexOf('message system')).toBeLessThan(input.indexOf('system instructions'));
  });

  it('rejects capabilities that the text-only descriptors disable', async () => {
    const spawn = () => { throw new Error('should not spawn'); };
    const client = createClaudeCodeClient({ spawn });

    const withTools = await collect(client.stream({
      ...textRequest(),
      tools: [{
        name: 'lookup',
        description: 'Look something up',
        inputSchema: z.object({}),
        handler: async () => 'unused',
      }],
    }));
    expect(withTools[1]).toMatchObject({
      type: 'error',
      message: expect.stringContaining('does not support tools'),
      retryable: false,
    });

    const withReasoning = await collect(client.stream({ ...textRequest(), reasoning: true }));
    expect(withReasoning[1]).toMatchObject({
      type: 'error',
      message: expect.stringContaining('does not support reasoning'),
      retryable: false,
    });
  });

  it('turns malformed and unsupported records into non-retryable errors', async () => {
    for (const output of [['not json'], [JSON.stringify({ type: 'mystery' })]]) {
      const dir = await makeFakeClaudeRaw(output);
      const events = await collect(createClaudeCodeClient({ executable: join(dir, 'claude') }).stream(textRequest()));
      expect(events[0]?.type).toBe('message_start');
      expect(events[1]).toMatchObject({ type: 'error', retryable: false });
    }
  });

  it('estimates tokens deterministically without spawning Claude', async () => {
    let spawned = false;
    const client = createClaudeCodeClient({ spawn: () => { spawned = true; throw new Error('should not spawn'); } });
    const request = textRequest();
    const first = await client.countTokens(request);
    expect(await client.countTokens(request)).toBe(first);
    expect(first).toBeGreaterThan(0);
    expect(spawned).toBe(false);
  });
});

function textRequest(): ProviderRequest {
  return {
    model: 'claude-sonnet-4-6',
    system: 'system instructions',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'prior user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'prior assistant' }] },
      { role: 'user', content: [{ type: 'text', text: 'latest user' }] },
    ],
  };
}

async function makeFailingClaude(stderr: string, exitCode: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-claude-test-'));
  tempDirs.push(dir);
  const executable = join(dir, 'claude');
  await writeFile(executable, `#!/usr/bin/env node\nconsole.error(${JSON.stringify(stderr)});\nprocess.exit(${exitCode});\n`, 'utf8');
  await chmod(executable, 0o755);
  return dir;
}

async function makeFakeClaude(
  records: unknown[],
  workspaceWrite?: { readonly path: string; readonly content: string },
): Promise<string> {
  return makeFakeClaudeRaw(records.map((record) => JSON.stringify(record)), workspaceWrite);
}

async function makeFakeClaudeRaw(
  lines: string[],
  workspaceWrite?: { readonly path: string; readonly content: string },
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-claude-test-'));
  tempDirs.push(dir);
  const executable = join(dir, 'claude');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  fs.writeFileSync(path.join(__dirname, 'args.json'), JSON.stringify(args));
  fs.writeFileSync(path.join(__dirname, 'input.txt'), input);
  const permissionModeIndex = args.indexOf('--permission-mode');
  if (permissionModeIndex >= 0 && !['acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'].includes(args[permissionModeIndex + 1])) {
    console.error('Invalid permission mode: ' + args[permissionModeIndex + 1]);
    process.exitCode = 2;
    return;
  }
  fs.writeFileSync(path.join(__dirname, 'cwd.txt'), process.cwd());
  const workspaceWrite = ${JSON.stringify(workspaceWrite)};
  if (workspaceWrite) fs.writeFileSync(path.join(process.cwd(), workspaceWrite.path), workspaceWrite.content);
  for (const line of ${JSON.stringify(lines)}) console.log(line);
});
`;
  await writeFile(executable, source, 'utf8');
  await chmod(executable, 0o755);
  return dir;
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
