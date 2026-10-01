import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext, ComputerControlService, MoxxyEvent, ToolDef, ToolImageResult } from '@moxxy/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REQUEST_ACCESS_TOOL } from './access.js';
import { ComputerBackend, type PlatformProfile } from './backend.js';
import { contractHelperScript, helperRequests, memoryLog, toolContext } from './helper.fixture.js';
import { CONTRACT_PROTOCOL_VERSION } from './rpc.js';

let directory: string;
let requestsFile: string;
let events: MoxxyEvent[];
let backends: ComputerBackend[];

const profile = (): PlatformProfile => ({
  platform: 'darwin',
  protocolVersion: CONTRACT_PROTOCOL_VERSION,
  helperPath: process.execPath,
  helperArgs: [contractHelperScript, '--log', requestsFile],
  // Artifact verification has its own tests; the fixture is a script, not a signed binary.
  verifyHelper: async () => undefined,
  unavailableMessage: 'Computer Use helper is missing.',
});

function backend(): { instance: ComputerBackend; tools: Map<string, ToolDef> } {
  const instance = new ComputerBackend(profile());
  backends.push(instance);
  return { instance, tools: new Map(instance.tools().map((tool) => [tool.name, tool])) };
}

let seq = 0;
const base = (turnId: string) => ({ id: `e${seq}`, seq: seq++, ts: 0, sessionId: 'session', turnId, source: 'system' });

async function run(tools: Map<string, ToolDef>, name: string, input: unknown, turnId = 'turn'): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(tool.inputSchema.parse(input), toolContext(memoryLog(events), { turnId }));
}

/** Record a request the way dispatch does: requested → approved → result. */
async function requestAccess(tools: Map<string, ToolDef>, input: Record<string, unknown>, turnId = 'turn'): Promise<unknown> {
  const callId = `call-${seq}`;
  events.push({ ...base(turnId), type: 'tool_call_requested', callId, name: REQUEST_ACCESS_TOOL, input } as MoxxyEvent);
  events.push({ ...base(turnId), type: 'tool_call_approved', callId, decidedBy: 'resolver', mode: 'allow' } as MoxxyEvent);
  const output = await run(tools, REQUEST_ACCESS_TOOL, input, turnId);
  events.push({ ...base(turnId), type: 'tool_result', callId, ok: true, output } as MoxxyEvent);
  return output;
}

const methods = () => helperRequests(requestsFile).map((request) => request.method);
const forModel = (output: unknown) => (output as ToolImageResult).forModel ?? String(output);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'moxxy-computer-backend-'));
  requestsFile = join(directory, 'requests.jsonl');
  events = [];
  backends = [];
});

afterEach(async () => {
  await Promise.all(backends.map((instance) => instance.release('session')));
  rmSync(directory, { recursive: true, force: true });
});

describe('computer_request_access', () => {
  it('grants resolved apps at their category level and reports the rest', async () => {
    const { tools } = backend();
    const output = await requestAccess(tools, { apps: ['TextEdit', 'Safari', 'Terminal', 'Notes', 'Mail'], reason: 'Edit a note' });
    expect(output).toEqual({
      kind: 'computer_access',
      granted: [
        { id: 'com.apple.TextEdit', name: 'TextEdit', tier: 'full' },
        { id: 'com.apple.Safari', name: 'Safari', tier: 'read' },
        { id: 'com.apple.Terminal', name: 'Terminal', tier: 'click' },
      ],
      unresolved: [
        { app: 'Notes', reason: 'ambiguous', candidates: [{ id: 'com.example.notes.one', name: 'Notes' }, { id: 'com.example.notes.two', name: 'Notes' }] },
        { app: 'Mail', reason: 'not_found' },
      ],
      clipboard_read: false, clipboard_write: false, system_key_combos: false,
    });
  });

  it('lifts a restricted default only for apps the user approved as full_access', async () => {
    const { tools } = backend();
    const output = await requestAccess(tools, { apps: ['Safari'], reason: 'Fill a form', full_access: ['Safari'] }) as { granted: unknown[] };
    expect(output.granted).toEqual([{ id: 'com.apple.Safari', name: 'Safari', tier: 'full' }]);
  });
});

describe('observation', () => {
  it('refuses an app that was not granted without asking the helper', async () => {
    const { tools } = backend();
    await expect(run(tools, 'computer_get_app_state', { app: 'TextEdit' })).rejects.toMatchObject({ code: 'app_not_allowed' });
    expect(methods()).not.toContain('get_app_state');
  });

  it('returns the indexed tree as untrusted content with the screenshot, then only what changed', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    const first = await run(tools, 'computer_get_app_state', { app: 'textedit' }) as ToolImageResult;
    expect(first).toMatchObject({ mediaType: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(first.forModel).toContain('<app_content app="TextEdit" trust="untrusted">');
    expect(first.forModel).toContain('[1] text area value="hello" focused');
    expect(first.forModel).toMatch(/Screenshot 800x600/);
    expect(helperRequests(requestsFile).at(-1)).toEqual({ method: 'get_app_state', params: { app: 'com.apple.TextEdit', screenshot: true } });
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }))).toMatch(/No changes/);
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit', disable_diff: true }))).toContain('[2] button "Save"');
  });

  it('shows every surface where the agent cursor is and which window it works in', async () => {
    const { instance, tools } = backend();
    const services = new Map<string, unknown>();
    await instance.hooks.onInit?.({ sessionId: 'session', services: { register: (name: string, impl: unknown) => services.set(name, impl) } } as unknown as AppContext);
    const control = services.get('computerControl') as ComputerControlService;
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    expect((await control.snapshot())[0]).toMatchObject({
      cursor: { phase: 'idle', x: 0.5, y: 0.5 }, target: { app: 'TextEdit', window: 'Untitled' },
    });
  });

  it('turns a coded helper refusal into a Computer Use error with its hint', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['Terminal'], reason: 'Read output' });
    await expect(run(tools, 'computer_get_app_state', { app: 'Terminal' }))
      .rejects.toMatchObject({ code: 'permissions_not_granted', message: expect.stringMatching(/System Settings/) });
  });

  it('marks granted apps in the app list', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['Safari'], reason: 'Read' });
    const listed = await run(tools, 'computer_list_apps', { query: 'a' }) as { apps: Array<{ id: string; access?: string }> };
    expect(listed.apps.find((app) => app.id === 'com.apple.Safari')?.access).toBe('read');
    expect(listed.apps.find((app) => app.id === 'com.apple.Terminal')?.access).toBeUndefined();
  });
});

describe('actions', () => {
  it('acts on the granted app and returns the outcome with the fresh state', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    const output = forModel(await run(tools, 'computer_type_text', { app: 'TextEdit', text: ' world' }));
    expect(output).toMatch(/Action delivered/);
    expect(output).toContain('~ [1] text area value="hello world" focused');
    expect(helperRequests(requestsFile).at(-1)).toEqual({
      method: 'act',
      params: { app: 'com.apple.TextEdit', action: { action: 'type_text', text: ' world' }, allowed: ['com.apple.TextEdit'] },
    });
  });

  it('notices an action that leaves the app unchanged and refuses a third try of it', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    // Save changes nothing in the scripted app.
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 }))).toMatch(/Nothing visible changed/);
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 }))).toMatch(/Action ineffective \(no_progress\)/);
    const sent = methods().filter((method) => method === 'act').length;
    await expect(run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 })).rejects.toMatchObject({ code: 'no_progress' });
    expect(methods().filter((method) => method === 'act')).toHaveLength(sent);
    // Typing changes the document: progress, and the count starts over.
    expect(forModel(await run(tools, 'computer_type_text', { app: 'TextEdit', text: '!' }))).not.toMatch(/Nothing visible changed/);
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 }))).toMatch(/Nothing visible changed/);
  });

  it('refuses an action above the granted level before it reaches the helper', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['Safari'], reason: 'Read' });
    await expect(run(tools, 'computer_click', { app: 'Safari', element_index: 2 })).rejects.toMatchObject({ code: 'tier_insufficient' });
    expect(methods()).not.toContain('act');
  });

  it('hands the helper parsed chords so no helper parses xdotool itself', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_press_key', { app: 'TextEdit', key: 'super+shift+Z' });
    await run(tools, 'computer_click', { app: 'TextEdit', element_index: 1, modifiers: 'cmd+alt' });
    await run(tools, 'computer_batch', { app: 'TextEdit', actions: [{ action: 'hold_key', key: 'shift', duration_s: 1 }] });
    const sent = helperRequests(requestsFile).filter((request) => request.method !== 'resolve_apps');
    expect(sent[0]?.params.action).toMatchObject({ action: 'press_key', key: 'super+shift+Z', chord: { modifiers: ['shift', 'meta'], key: 'z' } });
    expect(sent[1]?.params.action).toMatchObject({ action: 'click', held: ['alt', 'meta'] });
    expect((sent[2]?.params.actions as unknown[])[0]).toMatchObject({ action: 'hold_key', chord: { modifiers: ['shift'], key: null } });
  });

  it('refuses a system chord without the grant', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await expect(run(tools, 'computer_press_key', { app: 'TextEdit', key: 'super+q' })).rejects.toMatchObject({ code: 'system_key_combo' });
    expect(methods()).not.toContain('act');
  });

  it('runs a batch until the first step that did not go through', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    const output = forModel(await run(tools, 'computer_batch', { app: 'TextEdit', actions: [
      { action: 'type_text', text: '!' },
      { action: 'click', element_index: 3 },
      { action: 'press_key', key: 'Return' },
    ] }));
    expect(output).toContain('1. type_text: Action delivered');
    expect(output).toContain('2. click: Action blocked (target_blocked)');
    expect(output).toMatch(/Stopped after step 2 of 3/);
  });

  it('checks every batch step against the grant before starting', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['Terminal'], reason: 'Run' });
    await expect(run(tools, 'computer_batch', { app: 'Terminal', actions: [{ action: 'click', element_index: 2 }, { action: 'type_text', text: 'rm -rf ~' }] }))
      .rejects.toMatchObject({ code: 'tier_insufficient' });
    expect(methods()).not.toContain('batch');
  });
});

describe('full-screen capture', () => {
  it('needs a grant and shows only granted apps', async () => {
    const { tools } = backend();
    await expect(run(tools, 'computer_screenshot', {})).rejects.toMatchObject({ code: 'app_not_allowed' });
    await requestAccess(tools, { apps: ['TextEdit', 'Safari'], reason: 'Compare' });
    const shot = await run(tools, 'computer_screenshot', { scale: 0.5 }) as ToolImageResult;
    expect(shot.forModel).toMatch(/Screenshot 1440x900/);
    expect(helperRequests(requestsFile).at(-1)).toEqual({ method: 'screenshot', params: { scale: 0.5, allowed: ['com.apple.TextEdit', 'com.apple.Safari'] } });
    const zoom = await run(tools, 'computer_zoom', { region: [0, 0, 100, 50], app: 'Safari' }) as ToolImageResult;
    expect(helperRequests(requestsFile).at(-1)).toEqual({ method: 'zoom', params: { region: [0, 0, 100, 50], app: 'com.apple.Safari', allowed: ['com.apple.TextEdit', 'com.apple.Safari'] } });
    expect(zoom.forModel).toMatch(/Reading aid/);
    // A full-screen zoom shows only apps that are still granted.
    await run(tools, 'computer_zoom', { region: [0, 0, 100, 50], scale: 0.5 });
    expect(helperRequests(requestsFile).at(-1)).toEqual({ method: 'zoom', params: { region: [0, 0, 100, 50], scale: 0.5, allowed: ['com.apple.TextEdit', 'com.apple.Safari'] } });
  });
});

describe('one state for every client and turn lifecycle', () => {
  it('honours a grant recorded by another client of the same session', async () => {
    const desktop = backend();
    await requestAccess(desktop.tools, { apps: ['TextEdit'], reason: 'Edit' });
    const telegram = backend();
    expect(forModel(await run(telegram.tools, 'computer_get_app_state', { app: 'TextEdit' }))).toContain('[0] window "Untitled"');
  });

  it('starts every turn from a full tree on a fresh helper and closes it at turn end', async () => {
    const { instance, tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' }, 'one');
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'one');
    await instance.hooks.onTurnEnd?.({ sessionId: 'session', turnId: 'one', iteration: 0 } as unknown as Parameters<NonNullable<typeof instance.hooks.onTurnEnd>>[0]);
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'two'))).toContain('[0] window "Untitled"');
  });

  it('keeps Computer Use stopped for the rest of the turn after the panel Stop', async () => {
    const { instance, tools } = backend();
    const services = new Map<string, unknown>();
    await instance.hooks.onInit?.({ sessionId: 'session', services: { register: (name: string, impl: unknown) => services.set(name, impl) } } as unknown as AppContext);
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    const control = services.get('computerControl') as { control(input: unknown): Promise<void> };
    await control.control({ sessionId: 'session', turnId: 'turn', command: 'stop' });
    await expect(run(tools, 'computer_get_app_state', { app: 'TextEdit' })).rejects.toThrow(/stopped for this turn/);
  });
});
