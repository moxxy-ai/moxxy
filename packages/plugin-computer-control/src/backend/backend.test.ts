import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext, ComputerControlService, MoxxyEvent, ToolDef, ToolImageResult } from '@moxxy/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REQUEST_ACCESS_TOOL } from './access.js';
import type { AppHint } from './app-hints.js';
import { ComputerBackend, type PlatformProfile } from './backend.js';
import { contractHelperScript, helperRequests, memoryLog, toolContext } from './helper.fixture.js';
import type { PreviewMessage } from '../preview/controller.js';
import { CONTRACT_PROTOCOL_VERSION } from './rpc.js';

let directory: string;
let requestsFile: string;
let events: MoxxyEvent[];
let backends: ComputerBackend[];

const profile = (extra: Partial<PlatformProfile> = {}): PlatformProfile => ({
  ...extra,
  platform: 'darwin',
  protocolVersion: CONTRACT_PROTOCOL_VERSION,
  helperPath: process.execPath,
  helperArgs: [contractHelperScript, '--log', requestsFile],
  // Artifact verification has its own tests; the fixture is a script, not a signed binary.
  verifyHelper: async () => undefined,
  unavailableMessage: 'Computer Use helper is missing.',
});

function backend(hints: AppHint[] = [], extra: Partial<PlatformProfile> = {}): { instance: ComputerBackend; tools: Map<string, ToolDef> } {
  const instance = new ComputerBackend(profile(extra), hints);
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
  it('marks the tools that only look as live state, so the loop guard lets them repeat between actions', () => {
    const { tools } = backend();
    const live = [...tools.values()].filter((tool) => tool.liveState).map((tool) => tool.name).sort();
    expect(live).toEqual(['computer_get_app_state', 'computer_list_apps', 'computer_status', 'computer_zoom']);
  });

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

  it('asks a browser for its page content and says when the page is not readable yet', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['Safari', 'TextEdit'], reason: 'Read' });
    const page = forModel(await run(tools, 'computer_get_app_state', { app: 'Safari' }));
    const editor = forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }));
    const asked = helperRequests(requestsFile).filter((request) => request.method === 'get_app_state').map((request) => request.params);
    expect(asked).toEqual([{ app: 'com.apple.Safari', screenshot: true, web: true }, { app: 'com.apple.TextEdit', screenshot: true }]);
    expect(page).toMatch(/page content is not readable yet.*look again/i);
    expect(editor).not.toMatch(/not readable yet/);
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

  it('does not send again an action the helper itself found ineffective', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 4 }))).toMatch(/Nothing visible changed/);
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 4 }))).toMatch(/Action ineffective.*A real click changed nothing either/s);
    const sent = methods().filter((method) => method === 'act').length;
    await expect(run(tools, 'computer_click', { app: 'TextEdit', element_index: 4 })).rejects.toMatchObject({ code: 'no_progress' });
    expect(methods().filter((method) => method === 'act')).toHaveLength(sent);
  });

  it('names the field of a helper result that breaks the contract', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await expect(run(tools, 'computer_type_text', { app: 'TextEdit', text: '<twins>' })).rejects.toMatchObject({
      code: 'helper_failed', message: expect.stringMatching(/invalid act result \(state\.tree\.elements\.4\.key: Duplicate element key/),
    });
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
    const sent = helperRequests(requestsFile).filter((request) => request.method !== 'resolve_apps');
    expect(sent[0]?.params.action).toMatchObject({ action: 'press_key', key: 'super+shift+Z', chord: { modifiers: ['shift', 'meta'], key: 'z' } });
    expect(sent[1]?.params.action).toMatchObject({ action: 'click', held: ['alt', 'meta'] });
  });

  it('refuses a system chord without the grant', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await expect(run(tools, 'computer_press_key', { app: 'TextEdit', key: 'super+q' })).rejects.toMatchObject({ code: 'system_key_combo' });
    expect(methods()).not.toContain('act');
  });

  it('sends a drag between two points as a path the helper walks at a pace apps read as a drag', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_drag', { app: 'TextEdit', from_x: 558, from_y: 660, to_x: 340, to_y: 660 });
    expect(helperRequests(requestsFile).at(-1)?.params.action).toEqual({ action: 'drag', path: [[558, 660], [340, 660]], duration_ms: 600, mouse_button: 'left' });
  });
});

describe('a closer look', () => {
  it('zooms into the screenshot of a granted app', async () => {
    const { tools } = backend();
    await expect(run(tools, 'computer_zoom', { app: 'Safari', region: [0, 0, 100, 50] })).rejects.toMatchObject({ code: 'app_not_allowed' });
    await requestAccess(tools, { apps: ['TextEdit', 'Safari'], reason: 'Compare' });
    const zoom = await run(tools, 'computer_zoom', { region: [0, 0, 100, 50], app: 'Safari' }) as ToolImageResult;
    expect(helperRequests(requestsFile).at(-1)).toEqual({ method: 'zoom', params: { region: [0, 0, 100, 50], app: 'com.apple.Safari', allowed: ['com.apple.TextEdit', 'com.apple.Safari'] } });
    expect(zoom.forModel).toMatch(/Reading aid/);
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

describe('computer_status', () => {
  it('reports what the helper may do and which permission is missing, without needing access to any app', async () => {
    const { tools } = backend();
    expect(await run(tools, 'computer_status', {})).toEqual({
      platform: 'darwin', ready: false,
      permissions: { accessibility: true, screenRecording: false },
      limitations: ['Screen Recording is not allowed: the helper cannot capture windows.'],
    });
    expect(methods()).toEqual(['status']);
  });

  it('opens the system settings pane for a missing permission when asked', async () => {
    const { tools } = backend();
    expect(await run(tools, 'computer_status', { open_settings: 'screen_recording' })).toMatchObject({ ready: false, settings_opened: true });
    expect(helperRequests(requestsFile).at(-1)).toEqual({ method: 'permissions.request', params: { kind: 'screen_recording' } });
  });

  it('leaves the settings alone when the permission it is asked about is already allowed', async () => {
    const { tools } = backend();
    const status = await run(tools, 'computer_status', { open_settings: 'accessibility' });
    expect(status).toMatchObject({ ready: false });
    expect(status).not.toHaveProperty('settings_opened');
    expect(helperRequests(requestsFile).map((request) => request.method)).not.toContain('permissions.request');
  });
});

describe('app hints', () => {
  const hints: AppHint[] = [{ apps: ['com.apple.textedit'], text: 'Prefer set_value for whole documents.' }];

  it('shows an app\'s hint with its first state in a turn, and not again until the next turn', async () => {
    const { tools } = backend(hints);
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }))).toContain('Prefer set_value for whole documents.');
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }))).not.toContain('Prefer set_value');
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 }))).not.toContain('Prefer set_value');
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'next-turn'))).toContain('Prefer set_value for whole documents.');
  });

  it('shows the hint with the first action when the model acts before looking', async () => {
    const { tools } = backend(hints);
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 }))).toContain('Prefer set_value for whole documents.');
  });
});

describe('file panel notes', () => {
  it('tells how to choose a file when an open or save panel shows, once in a turn', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Open a file' });
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }))).not.toContain('File dialog');
    const opened = forModel(await run(tools, 'computer_type_text', { app: 'TextEdit', text: '<file-panel>' }));
    expect(opened).toContain('File dialog');
    expect(opened).toMatch(/super\+shift\+g/);
    expect(opened).toMatch(/selected even when the list does not show it/);
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }))).not.toContain('File dialog');
  });
});

describe('live preview', () => {
  const waitFor = async (done: () => boolean) => {
    for (let tries = 0; tries < 200 && !done(); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done()).toBe(true);
  };

  it('captures for a viewer of the turn that uses the computer, and ends with that turn', async () => {
    const { instance, tools } = backend();
    const messages: PreviewMessage[] = [];
    instance.preview.subscribe((message) => messages.push(message));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    await waitFor(() => messages.some((message) => message.type === 'frame'));
    expect(messages.find((message) => message.type === 'frame')).toEqual({
      type: 'frame', seq: 1, image: { mediaType: 'image/jpeg', base64: 'frame@2', width: 640, height: 400 },
    });
    expect(helperRequests(requestsFile).filter((request) => request.method === 'preview.start')).toEqual([{ method: 'preview.start', params: { fps: 2 } }]);
    await instance.release('session', 'turn');
    expect(messages.at(-1)).toEqual({ type: 'state', state: 'stopped' });
    expect(instance.preview.snapshot()).toEqual({ state: 'stopped' });
  });

  it('shows no picture after the user stops Computer Use', async () => {
    const { instance, tools } = backend();
    const services = new Map<string, unknown>();
    await instance.hooks.onInit?.({ sessionId: 'session', services: { register: (name: string, impl: unknown) => services.set(name, impl) } } as unknown as AppContext);
    const messages: PreviewMessage[] = [];
    instance.preview.subscribe((message) => messages.push(message));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    await waitFor(() => messages.some((message) => message.type === 'frame'));
    const control = services.get('computerControl') as { control(input: unknown): Promise<void> };
    await control.control({ sessionId: 'session', turnId: 'turn', command: 'stop' });
    await waitFor(() => instance.preview.snapshot().state === 'stopped');
    expect(instance.preview.snapshot()).toEqual({ state: 'stopped' });
  });

  it('never asks the helper to capture when nobody watches', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    expect(methods()).not.toContain('preview.start');
  });

  it('keeps frames away from the model: no tool result carries a preview frame', async () => {
    const { instance, tools } = backend();
    instance.preview.subscribe(() => undefined);
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    const output = await run(tools, 'computer_get_app_state', { app: 'TextEdit' });
    expect(JSON.stringify(output)).not.toContain('frame@');
    expect(JSON.stringify(events)).not.toContain('frame@');
  });

  it('asks a helper that makes video for video when the viewer can decode it, and for a key frame on demand', async () => {
    const { instance, tools } = backend([], { previewCodecs: ['h264', 'jpeg'] });
    const messages: PreviewMessage[] = [];
    const listener = (message: PreviewMessage) => { messages.push(message); };
    instance.preview.subscribe(listener, ['h264', 'jpeg']);
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    await waitFor(() => messages.some((message) => message.type === 'chunk'));
    expect(messages.find((message) => message.type === 'chunk')).toEqual({
      type: 'chunk', seq: 1, key: true, codec: 'avc1.4d001f', data: 'dmlkZW8=', timestamp: 0, width: 640, height: 400,
    });
    instance.preview.keyframe(listener);
    await waitFor(() => methods().includes('preview.keyframe'));
    expect(helperRequests(requestsFile).find((request) => request.method === 'preview.start')).toEqual({ method: 'preview.start', params: { fps: 30, codec: 'h264' } });
  });

  it('asks a helper without video for pictures, with no codec in the request', async () => {
    const { instance, tools } = backend();
    const messages: PreviewMessage[] = [];
    instance.preview.subscribe((message) => messages.push(message), ['h264', 'jpeg']);
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit a note' });
    await waitFor(() => messages.some((message) => message.type === 'frame'));
    expect(helperRequests(requestsFile).filter((request) => request.method.startsWith('preview.'))).toEqual([{ method: 'preview.start', params: { fps: 2 } }]);
  });

  it('offers the preview as a surface of the plugin', () => {
    const { instance } = backend();
    expect(instance.surfaces().map((surface) => surface.kind)).toEqual(['computer-preview']);
  });
});
