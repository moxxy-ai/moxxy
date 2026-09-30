import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageBudget } from '../contract/image.js';
import { verifyHelperArtifact } from '../helper/artifact.js';
import { HelperTransport, type HelperEvent } from '../helper/transport.js';
import { CONTRACT_PROTOCOL_VERSION, actResultSchema, appStateSchema, contractEventsFor, listAppsResultSchema, resolveAppsResultSchema, statusResultSchema } from '../backend/rpc.js';
import { macosHelperPath, macosProfile } from './profile.js';
import { ComputerBackend } from '../backend/backend.js';
import { REQUEST_ACCESS_TOOL } from '../backend/access.js';
import { memoryLog, toolContext } from '../backend/helper.fixture.js';
import type { MoxxyEvent, ToolImageResult } from '@moxxy/sdk';

// Talks to the real universal helper built by native/macos/build.sh; other hosts and unbuilt trees skip.
const built = process.platform === 'darwin' && existsSync(macosHelperPath);
const signal = () => new AbortController().signal;
const start = (onEvent?: (event: HelperEvent) => void) => new HelperTransport(macosHelperPath, ['--parent', String(process.pid)], {
  protocolVersion: CONTRACT_PROTOCOL_VERSION, events: contractEventsFor(CONTRACT_PROTOCOL_VERSION), ...(onEvent ? { onEvent } : {}),
});

describe.skipIf(!built)('macOS native helper', () => {
  it('is a verified universal artifact for the shared protocol', async () => {
    await expect(verifyHelperArtifact(macosHelperPath, CONTRACT_PROTOCOL_VERSION)).resolves.toBeUndefined();
  });

  it('reports its readiness and the permissions it still needs', async () => {
    const transport = start();
    try {
      const status = statusResultSchema.parse(await transport.request('status', {}, signal()));
      expect(status.ready).toBe(status.permissions.accessibility && status.permissions.screenRecording);
    } finally { await transport.close(); }
  });

  it('refuses an unknown method with a code and keeps serving', async () => {
    const transport = start();
    try {
      await expect(transport.request('teleport', {}, signal())).rejects.toMatchObject({ code: 'unsupported_action' });
      await expect(transport.request('status', {}, signal())).resolves.toBeTypeOf('object');
    } finally { await transport.close(); }
  });

  it('lists and resolves installed and running apps in the contract shape', async () => {
    const transport = start();
    try {
      const listed = listAppsResultSchema.parse(await transport.request('list_apps', { query: 'finder', limit: 5 }, signal()));
      expect(listed.apps[0]).toEqual({ id: 'com.apple.finder', name: 'Finder', running: true });
      const resolved = resolveAppsResultSchema.parse(await transport.request('resolve_apps', { names: ['Calculator', 'No Such App 1234'] }, signal()));
      expect(resolved.apps[0]).toMatchObject({ request: 'Calculator', status: 'resolved', name: 'Calculator' });
      expect(resolved.apps[1]).toEqual({ request: 'No Such App 1234', status: 'not_found' });
    } finally { await transport.close(); }
  });

  it('exits as soon as its input closes', async () => {
    const transport = start();
    await transport.request('status', {}, signal());
    const started = performance.now();
    await transport.close();
    expect(performance.now() - started).toBeLessThan(450);
  });

  it('exits when the process it serves dies', async () => {
    const parent = spawn('/bin/sleep', ['30']);
    const helper = spawn(macosHelperPath, ['--parent', String(parent.pid)], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const exited = once(helper, 'exit');
      parent.kill('SIGKILL');
      const [code] = await Promise.race([exited, timeout(2000)]);
      expect(code).toBe(0);
    } finally { stop(helper); stop(parent); }
  });

  it('refuses to start without the process it serves', async () => {
    const helper = spawn(macosHelperPath, [], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const [code] = await Promise.race([once(helper, 'exit'), timeout(2000)]);
      expect(code).toBe(64);
    } finally { stop(helper); }
  });
});

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`no exit within ${ms} ms`)), ms).unref());
}

function stop(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

// The test-only AppKit app from native/macos/build-fixture.sh, registered with LaunchServices.
const FIXTURE = 'ai.moxxy.computer-fixture';
const fixtureBuilt = built && existsSync(new URL('../../native/macos/.build/fixture/MoxxyComputerFixture.app', import.meta.url));
const quitFixture = async () => {
  spawnSync('pkill', ['-x', 'MoxxyComputerFixture']);
  for (let attempt = 0; attempt < 50 && spawnSync('pgrep', ['-x', 'MoxxyComputerFixture']).status === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe.skipIf(!fixtureBuilt)('macOS app state', () => {
  beforeAll(quitFixture);
  afterAll(quitFixture);

  it('launches the app in the background and returns its indexed accessibility tree', async () => {
    const transport = start();
    try {
      const state = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      expect(state.tree).toMatchObject({ app: 'Moxxy Computer Fixture', window: 'Moxxy Fixture' });
      const byKey = new Map(state.tree.elements.map((element) => [element.key.split('/').at(-1), element]));
      expect(byKey.get('text field:name')).toMatchObject({ value: 'hello', description: 'placeholder: Name' });
      expect(byKey.get('button:press')).toMatchObject({ role: 'button', title: 'Press' });
      expect(byKey.get('checkbox:remember')).toMatchObject({ states: ['checked'] });
      expect(byKey.get('button:disabled')?.states).toContain('disabled');
      expect(byKey.get('text:status')).toMatchObject({ title: 'Ready' });
      const secret = [...byKey.values()].find((element) => element.secure);
      expect(secret?.value).toBeUndefined();
      expect(JSON.stringify(state)).not.toContain('hunter2');
      expect(state.tree.elements.some((element) => element.role === 'group')).toBe(false);
    } finally { await transport.close(); }
  });

  it('waits for a freshly launched app to finish loading', async () => {
    await quitFixture();
    const transport = start();
    try {
      const started = performance.now();
      const state = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      expect(performance.now() - started).toBeLessThan(6000);
      expect(state.tree.elements.find((element) => element.key.endsWith('text:loaded'))?.title).toBe('Loaded');
      expect(state.tree.elements.some((element) => element.role.includes('busy') || element.role.includes('progress'))).toBe(false);
    } finally { await transport.close(); }
  });

  it('keeps every element index across observations', async () => {
    const transport = start();
    try {
      const first = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      const second = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      const indices = (state: typeof first) => Object.fromEntries(state.tree.elements.map((element) => [element.key, element.index]));
      expect(indices(second)).toEqual(indices(first));
    } finally { await transport.close(); }
  });

  it('captures the window within the image budget and places elements in its pixels', async () => {
    const transport = start();
    try {
      const state = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: true }, signal()));
      const shot = state.screenshot;
      expect(shot?.mediaType).toBe('image/jpeg');
      expect(Buffer.from(shot?.base64 ?? '', 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      const width = shot?.width ?? 0;
      const height = shot?.height ?? 0;
      expect(imageBudget(width, height)).toEqual([width, height]);
      const press = state.tree.elements.find((element) => element.key.endsWith('button:press'));
      expect(press?.frame).toBeDefined();
      const frame = press?.frame ?? { x: -1, y: -1, width: 0, height: 0 };
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(height);
      expect(frame.width).toBeGreaterThan(10);
    } finally { await transport.close(); }
  });

  it('shows the agent cursor over the observed window and reports where it is', async () => {
    const events: HelperEvent[] = [];
    const transport = start((event) => events.push(event));
    try {
      await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal());
      expect(events).toContainEqual({ version: CONTRACT_PROTOCOL_VERSION, event: 'cursor', cursor: { phase: 'idle', x: 0.5, y: 0.5 } });
    } finally { await transport.close(); }
  });

  it('serves the model tools end to end through the shared backend', async () => {
    const backend = new ComputerBackend(macosProfile);
    const tools = new Map(backend.tools().map((tool) => [tool.name, tool]));
    const events: MoxxyEvent[] = [];
    const run = async (name: string, input: unknown, callId = 'c') => {
      const tool = tools.get(name);
      if (!tool) throw new Error(name);
      return tool.handler(tool.inputSchema.parse(input), toolContext(memoryLog(events), { callId }));
    };
    try {
      const request = { apps: [FIXTURE], reason: 'Integration test' };
      const base = { id: 'e', seq: 0, ts: 0, sessionId: 'session', turnId: 'turn', source: 'system' };
      events.push({ ...base, type: 'tool_call_requested', callId: 'grant', name: REQUEST_ACCESS_TOOL, input: request } as MoxxyEvent);
      events.push({ ...base, type: 'tool_call_approved', callId: 'grant', decidedBy: 'resolver', mode: 'allow' } as MoxxyEvent);
      const grant = await run(REQUEST_ACCESS_TOOL, request, 'grant');
      events.push({ ...base, type: 'tool_result', callId: 'grant', ok: true, output: grant } as MoxxyEvent);
      expect(grant).toMatchObject({ granted: [{ id: FIXTURE, name: 'Moxxy Computer Fixture', tier: 'full' }] });
      const state = await run('computer_get_app_state', { app: FIXTURE }) as ToolImageResult;
      expect(state.mediaType).toBe('image/jpeg');
      expect(state.forModel).toContain('<app_content app="Moxxy Computer Fixture" trust="untrusted">');
      expect(state.forModel).toMatch(/\[\d+\] button "Press"/);
      expect(state.forModel).not.toContain('hunter2');
      expect((await backend.controls.forSession('session').snapshot())[0]).toMatchObject({
        cursor: { phase: 'idle' }, target: { app: 'Moxxy Computer Fixture', window: 'Moxxy Fixture' },
      });
      const press = Number(/\[(\d+)\] button "Press"/.exec(state.forModel ?? '')?.[1]);
      const clicked = await run('computer_click', { app: FIXTURE, element_index: press }) as ToolImageResult;
      expect(clicked.forModel).toContain('Action delivered');
      expect(clicked.forModel).toMatch(/text "Pressed \d+"/);
    } finally { await backend.release('session'); }
  });

  describe('actions by element index', () => {
    const observe = async (transport: HelperTransport) =>
      appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
    const element = (state: { tree: { elements: Array<{ key: string; index: number; title?: string; value?: string }> } }, suffix: string) => {
      const found = state.tree.elements.find((candidate) => candidate.key.endsWith(suffix));
      if (!found) throw new Error(`no ${suffix}`);
      return found;
    };
    const act = async (transport: HelperTransport, action: Record<string, unknown>, allowed = [FIXTURE]) =>
      actResultSchema.parse(await transport.request('act', { app: FIXTURE, action, allowed }, signal()));

    it('presses a button through accessibility, shows the cursor at work and returns the new state', async () => {
      const events: HelperEvent[] = [];
      const transport = start((event) => events.push(event));
      try {
        const before = await observe(transport);
        const pressed = Number(/\d+/.exec(element(before, 'text:status').title ?? '')?.[0] ?? 0);
        events.length = 0;
        const { result, state } = await act(transport, { action: 'click', element_index: element(before, 'button:press').index, mouse_button: 'left', click_count: 1 });
        expect(result).toEqual({ outcome: 'delivered', method: 'ax' });
        expect(element(state ?? before, 'text:status').title).toBe(`Pressed ${pressed + 1}`);
        const phases = events.map((event) => (event as { cursor: { phase: string } | null }).cursor?.phase);
        expect(phases.slice(0, 3)).toEqual(['moving', 'executing', 'delivered']);
      } finally { await transport.close(); }
    });

    it('sets a text field and runs an action the element lists', async () => {
      const transport = start();
      try {
        const before = await observe(transport);
        const named = await act(transport, { action: 'set_value', element_index: element(before, 'text field:name').index, value: 'world' });
        expect(named.result).toEqual({ outcome: 'delivered', method: 'ax' });
        expect(element(named.state ?? before, 'text field:name').value).toBe('world');
        const stepper = element(before, ':count');
        const stepped = await act(transport, { action: 'perform_secondary_action', element_index: stepper.index, secondary_action: 'AXIncrement' });
        expect(stepped.result).toEqual({ outcome: 'delivered', method: 'ax' });
        expect(Number(element(stepped.state ?? before, ':count').value)).toBe(Number(stepper.value) + 1);
      } finally { await transport.close(); }
    });

    it('refuses an action the element does not list, an index it never handed out and an app without a grant', async () => {
      const transport = start();
      try {
        const before = await observe(transport);
        const guessed = await act(transport, { action: 'perform_secondary_action', element_index: element(before, 'button:press').index, secondary_action: 'AXRaise' });
        expect(guessed.result).toEqual({ outcome: 'unsupported', code: 'unsupported_action' });
        const stale = await act(transport, { action: 'click', element_index: 9999, mouse_button: 'left', click_count: 1 });
        expect(stale.result).toEqual({ outcome: 'blocked', code: 'stale_state' });
        expect(stale.state?.tree.app).toBe('Moxxy Computer Fixture');
        await expect(act(transport, { action: 'click', element_index: 0, mouse_button: 'left', click_count: 1 }, ['com.apple.TextEdit']))
          .rejects.toMatchObject({ code: 'app_not_allowed' });
      } finally { await transport.close(); }
    });

    const name = async (transport: HelperTransport) => element(await observe(transport), 'text field:name');
    const chord = (key: string | null, modifiers: string[] = []) => ({ modifiers, key });

    it('selects text and types at the caret through accessibility, without bringing the app forward', async () => {
      const transport = start();
      try {
        const field = await name(transport);
        await act(transport, { action: 'set_value', element_index: field.index, value: 'one two three' });
        const selected = await act(transport, { action: 'select_text', element_index: field.index, text: 'two', selection_type: 'text' });
        expect(selected.result).toEqual({ outcome: 'delivered', method: 'ax' });
        const typed = await act(transport, { action: 'type_text', text: '2' });
        expect(typed.result).toEqual({ outcome: 'delivered', method: 'ax' });
        await act(transport, { action: 'select_text', element_index: field.index, text: 'one', selection_type: 'cursor_after' });
        await act(transport, { action: 'type_text', element_index: field.index, text: '!' });
        expect((await name(transport)).value).toBe('one! 2 three');
        expect(spawnSync('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true']).stdout.toString().trim())
          .not.toBe('MoxxyComputerFixture');
      } finally { await transport.close(); }
    });

    it('presses keys and chords into the app in the background', async () => {
      const transport = start();
      try {
        const field = await name(transport);
        await act(transport, { action: 'set_value', element_index: field.index, value: 'abc' });
        await act(transport, { action: 'select_text', element_index: field.index, text: 'abc', selection_type: 'cursor_after' });
        const erased = await act(transport, { action: 'press_key', key: 'BackSpace', repeat: 2, chord: chord('backspace') });
        expect(erased.result).toEqual({ outcome: 'delivered', method: 'input' });
        expect((await name(transport)).value).toBe('a');
        // Select All has an accessibility equivalent, so it works while the app stays in the background.
        const all = await act(transport, { action: 'press_key', key: 'super+a', repeat: 1, chord: chord('a', ['meta']) });
        expect(all.result).toEqual({ outcome: 'delivered', method: 'ax' });
        await act(transport, { action: 'type_text', text: 'Z' });
        expect((await name(transport)).value).toBe('Z');
        // Other Command shortcuts go through the menu bar, which only the app in front has.
        const copy = await act(transport, { action: 'press_key', key: 'super+c', repeat: 1, chord: chord('c', ['meta']) });
        expect(copy.result).toMatchObject({ outcome: 'blocked', code: 'not_frontmost' });
      } finally { await transport.close(); }
    });

    it('pastes plain text at the caret without touching the clipboard', async () => {
      const clipboard = () => spawnSync('pbpaste').stdout.toString();
      const transport = start();
      try {
        const before = clipboard();
        const field = await name(transport);
        await act(transport, { action: 'set_value', element_index: field.index, value: 'x' });
        await act(transport, { action: 'select_text', element_index: field.index, text: 'x', selection_type: 'cursor_after' });
        const pasted = await act(transport, { action: 'paste', text: 'PASTE', format: 'text' });
        expect(pasted.result).toEqual({ outcome: 'delivered', method: 'ax' });
        expect((await name(transport)).value).toBe('xPASTE');
        expect(clipboard()).toBe(before);
        // Rich text needs the clipboard and Command-V, so the app must be in front.
        const rich = await act(transport, { action: 'paste', text: '<b>bold</b>', format: 'html' });
        expect(rich.result).toMatchObject({ outcome: 'blocked', code: 'not_frontmost' });
        expect(clipboard()).toBe(before);
      } finally { await transport.close(); }
    });

    it('asks for prefix or suffix when the text to select repeats', async () => {
      const transport = start();
      try {
        const field = await name(transport);
        await act(transport, { action: 'set_value', element_index: field.index, value: 'hi there hi' });
        const { result } = await act(transport, { action: 'select_text', element_index: field.index, text: 'hi', selection_type: 'text' });
        expect(result).toMatchObject({ outcome: 'unsupported', code: 'unsupported_action' });
        expect(result.hint).toMatch(/2 times.*prefix or suffix/);
      } finally { await transport.close(); }
    });

    it('asks for an observation before the first action', async () => {
      const transport = start();
      try {
        const { result } = await act(transport, { action: 'click', element_index: 0, mouse_button: 'left', click_count: 1 });
        expect(result).toEqual({ outcome: 'blocked', code: 'no_state' });
      } finally { await transport.close(); }
    });
  });

  it('refuses an app it cannot find', async () => {
    const transport = start();
    try {
      await expect(transport.request('get_app_state', { app: 'ai.moxxy.no-such-app', screenshot: false }, signal())).rejects.toMatchObject({ code: 'app_not_found' });
    } finally { await transport.close(); }
  });
});
