import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageBudget } from '../contract/image.js';
import { verifyHelperArtifact } from '../helper/artifact.js';
import { HelperTransport, type HelperEvent } from '../helper/transport.js';
import { CONTRACT_PROTOCOL_VERSION, actResultSchema, appStateSchema, batchResultSchema, contractEventsFor, imageSchema, listAppsResultSchema, resolveAppsResultSchema, statusResultSchema } from '../backend/rpc.js';
import { macosHelperPath, macosProfile } from './profile.js';
import { ComputerBackend } from '../backend/backend.js';
import { REQUEST_ACCESS_TOOL } from '../backend/access.js';
import { memoryLog, toolContext } from '../backend/helper.fixture.js';
import type { MoxxyEvent, ToolImageResult } from '@moxxy/sdk';
import { computerTools } from '../contract/tools.js';
import { createComputerControlPlugin } from '../index.js';

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

  it('is what the plugin runs on this Mac: the shared tools, with a status answered by the helper', async () => {
    const plugin = createComputerControlPlugin();
    expect((plugin.tools ?? []).map((tool) => tool.name).sort()).toEqual(Object.keys(computerTools).sort());
    const status = plugin.tools?.find((tool) => tool.name === 'computer_status');
    try {
      const report = await status?.handler({}, toolContext(memoryLog([]), { sessionId: 'plugin-status' })) as { platform: string; ready: boolean; permissions: { accessibility: boolean; screenRecording: boolean } };
      expect(report.platform).toBe('darwin');
      expect(report.ready).toBe(report.permissions.accessibility && report.permissions.screenRecording);
    } finally {
      await plugin.hooks?.onShutdown?.({ sessionId: 'plugin-status' } as never);
    }
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
      expect(resolved.apps[0]).toMatchObject({ request: 'Calculator', status: 'resolved', id: 'com.apple.calculator' });
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
      // Plain stack views are flattened; only the labelled canvas stays a group.
      expect(state.tree.elements.filter((element) => element.role === 'group').map((element) => element.key.split('/').at(-1))).toEqual(['group:pad', 'group:timeline']);
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

      // A control that does nothing: said once, called ineffective the second time, not sent a third time.
      const full = await run('computer_get_app_state', { app: FIXTURE, disable_diff: true }) as ToolImageResult;
      const dud = Number(/\[(\d+)\] button "Dud"/.exec(full.forModel ?? '')?.[1]);
      const first = await run('computer_click', { app: FIXTURE, element_index: dud }) as ToolImageResult;
      expect(first.forModel).toContain('Nothing visible changed after this action');
      const second = await run('computer_click', { app: FIXTURE, element_index: dud }) as ToolImageResult;
      expect(second.forModel).toMatch(/ineffective/i);
      await expect(run('computer_click', { app: FIXTURE, element_index: dud })).rejects.toMatchObject({ code: 'no_progress' });
    } finally { await backend.release('session'); }
  });

  // Every action settles for at least a second before its fresh state comes back (as in Codex).
  describe('actions by element index', { timeout: 30_000 }, () => {
    const observe = async (transport: HelperTransport) =>
      appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
    type Listed = { key: string; index: number; title?: string; value?: string; description?: string; actions?: string[]; frame?: { x: number; y: number; width: number; height: number } };
    const element = (state: { tree: { elements: Listed[] } }, suffix: string) => {
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
    const frontmost = () => spawnSync('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true']).stdout.toString().trim();
    type Framed = { tree: { elements: Listed[] } };
    const look = async (transport: HelperTransport) =>
      appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: true }, signal()));
    const centre = (state: Framed, suffix: string) => {
      const { frame } = element(state, suffix);
      if (!frame) throw new Error(`${suffix} has no frame`);
      return { x: Math.round(frame.x + frame.width / 2), y: Math.round(frame.y + frame.height / 2) };
    };
    const pad = (state: Framed | undefined) => (state ? element(state, 'group:pad').description : undefined);

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
      } finally { await transport.close(); }
    });

    it('holds a key for as long as asked, in the background', async () => {
      const transport = start();
      try {
        await observe(transport);
        const { result, state } = await act(transport, { action: 'hold_key', key: 'shift', duration_s: 0.5, chord: chord(null, ['shift']) });
        expect(result).toEqual({ outcome: 'delivered', method: 'input' });
        expect(state && element(state, 'text:keys').title).toBe('Held key 56 for 0.5 s');
        expect(frontmost()).not.toBe('MoxxyComputerFixture');
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

    describe('by screenshot point and real pointer input', () => {
      const pointer = () => spawnSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); const p = $.NSEvent.mouseLocation; `${p.x},${p.y}`']).stdout.toString().trim().split(',').map(Number);
      // A trackpad leaves the pointer between points; putting it back may round to the nearest one.
      const expectPointerAt = (home: number[]) => pointer().forEach((axis, i) => expect(Math.abs(axis - (home[i] ?? NaN))).toBeLessThanOrEqual(1));

      it('presses a control under a point through accessibility, in the background', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          const pressed = Number(/\d+/.exec(element(before, 'text:status').title ?? '')?.[0] ?? 0);
          const { result, state } = await act(transport, { action: 'click', ...centre(before, 'button:press'), mouse_button: 'left', click_count: 1 });
          expect(result).toEqual({ outcome: 'delivered', method: 'ax' });
          expect(element(state ?? before, 'text:status').title).toBe(`Pressed ${pressed + 1}`);
          expect(frontmost()).not.toBe('MoxxyComputerFixture');
        } finally { await transport.close(); }
      });

      it('types into the text field under a point and refuses a point with no text field', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          const typed = await act(transport, { action: 'type_text', ...centre(before, 'text field:name'), text: 'Q' });
          expect(typed.result).toEqual({ outcome: 'delivered', method: 'ax' });
          expect(element(typed.state ?? before, 'text field:name').value).toContain('Q');
          const nowhere = await act(transport, { action: 'type_text', ...centre(typed.state ?? before, 'group:pad'), text: 'Q' });
          expect(nowhere.result).toMatchObject({ outcome: 'unsupported', code: 'unsupported_action', hint: expect.stringContaining('click the point first') });
        } finally { await transport.close(); }
      });

      it('refuses a point outside the screenshot or whose pixels changed since it', async () => {
        const transport = start();
        try {
          await look(transport);
          const outside = await act(transport, { action: 'click', x: 5000, y: 10, mouse_button: 'left', click_count: 1 });
          expect(outside.result).toMatchObject({ outcome: 'blocked', code: 'point_outside_frame' });
          // Another process changes the field behind the helper's back; the point is on its text, whose pixels change.
          const setField = (value: string) => spawnSync('osascript', ['-e', `tell application "System Events" to set value of text field 1 of window 1 of process "MoxxyComputerFixture" to "${value}"`]);
          setField('MMMMMMMMMMMMMMMM');
          const field = await look(transport);
          setField('');
          const text = { x: (element(field, 'text field:name').frame?.x ?? 0) + 40, y: centre(field, 'text field:name').y };
          const stale = await act(transport, { action: 'click', ...text, mouse_button: 'left', click_count: 1 });
          expect(stale.result).toMatchObject({ outcome: 'blocked', code: 'screen_changed' });
        } finally { await transport.close(); }
      });

      it('double-clicks a canvas with modifiers through the real pointer, then puts the pointer back', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          const home = pointer();
          const { result, state } = await act(transport, { action: 'click', ...centre(before, 'group:pad'), mouse_button: 'left', click_count: 2, modifiers: 'shift', held: ['shift'] });
          expect(result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(pad(state)).toBe('Pad up 2 after 0 moves shift');
          expectPointerAt(home);
        } finally { await transport.close(); }
      });

      it('drags along a path and spells out a press, move and release', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          const { x, y } = centre(before, 'group:pad');
          const home = pointer();
          const dragged = await act(transport, { action: 'drag', path: [[x - 100, y], [x + 100, y]], duration_ms: 200, mouse_button: 'left' });
          expect(dragged.result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(pad(dragged.state)).toMatch(/^Pad up 1 after ([2-9]|\d{2,}) moves$/);
          expectPointerAt(home);

          const hover = await act(transport, { action: 'mouse', event: 'move', x, y, mouse_button: 'left' });
          expect(hover.result).toMatchObject({ outcome: 'unsupported' });
          const down = await act(transport, { action: 'mouse', event: 'down', x: x - 50, y, mouse_button: 'left' });
          expect(pad(down.state)).toBe('Pad down 1');
          await act(transport, { action: 'mouse', event: 'move', x, y, mouse_button: 'left' });
          const up = await act(transport, { action: 'mouse', event: 'up', x: x + 50, y, mouse_button: 'left' });
          expect(up.result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(pad(up.state)).toMatch(/^Pad up 1 after [2-9] moves$/);
          expectPointerAt(home);
        } finally { await transport.close(); }
      });

      it('scrolls a list by pages through accessibility and a canvas with the wheel', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          const list = await act(transport, { action: 'scroll', element_index: element(before, 'scroll area:list').index, direction: 'down', pages: 1 });
          expect(list.result).toEqual({ outcome: 'delivered', method: 'ax' });
          expect(Number(/\d+/.exec(element(list.state ?? before, 'text:offset').title ?? '')?.[0])).toBeGreaterThan(0);
          const wheel = await act(transport, { action: 'scroll', ...centre(list.state ?? before, 'group:pad'), direction: 'down', pages: 1 });
          expect(wheel.result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(pad(wheel.state)).toMatch(/^Pad wheel -\d+$/);
        } finally { await transport.close(); }
      });
    });

    // Command shortcuts and rich-text paste need the menu bar, so the app comes forward and stays there.
    // Runs last: the tests above check the app stays in the background.
    describe('a canvas without accessibility: a timeline with clips', () => {
      const clips = (state: Framed | undefined) => (state ? element(state, 'group:timeline').description : undefined);
      /** A screenshot point `points` along the 420-point-wide timeline, on its middle line. */
      const along = (state: Framed, points: number) => {
        const { frame } = element(state, 'group:timeline');
        if (!frame) throw new Error('timeline has no frame');
        return [Math.round(frame.x + points * frame.width / 420), Math.round(frame.y + frame.height / 2)] as [number, number];
      };

      it('moves a clip by its body, trims another by its edge and selects with a click, from the picture alone', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          expect(clips(before)).toBe('Timeline A 20+80 B 140+60 selected none');
          expect(element(before, 'group:timeline').actions ?? []).toEqual([]);
          const moved = await act(transport, { action: 'drag', path: [along(before, 60), along(before, 80)], duration_ms: 300, mouse_button: 'left' });
          expect(moved.result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(clips(moved.state)).toBe('Timeline A 40+80 B 140+60 selected A');

          const state = moved.state ?? before;
          const trimmed = await act(transport, { action: 'drag', path: [along(state, 198), along(state, 218), along(state, 238)], duration_ms: 300, mouse_button: 'left' });
          expect(clips(trimmed.state)).toBe('Timeline A 40+80 B 140+100 selected B');

          const [x, y] = along(trimmed.state ?? state, 60);
          const picked = await act(transport, { action: 'click', x, y, mouse_button: 'left', click_count: 1 });
          expect(clips(picked.state)).toBe('Timeline A 40+80 B 140+100 selected A');
        } finally { await transport.close(); }
      });
    });

    describe('a layout that moves', () => {
      it('keeps the index of a control that moved and still presses it', async () => {
        const transport = start();
        try {
          const before = await look(transport);
          const press = element(before, 'button:press');
          const shifted = await act(transport, { action: 'click', element_index: element(before, 'button:shift').index, mouse_button: 'left', click_count: 1 });
          expect(shifted.result).toEqual({ outcome: 'delivered', method: 'ax' });
          const after = await look(transport);
          const moved = element(after, 'button:press');
          expect(moved.index).toBe(press.index);
          expect(moved.frame?.y).not.toBe(press.frame?.y);
          const pressed = Number(/Pressed (\d+)/.exec(element(after, 'text:status').title ?? '')?.[1] ?? 0);
          const clicked = await act(transport, { action: 'click', element_index: press.index, mouse_button: 'left', click_count: 1 });
          expect(element(clicked.state ?? after, 'text:status').title).toBe(`Pressed ${pressed + 1}`);
          // Back to the first layout for the tests that follow.
          await act(transport, { action: 'click', element_index: element(after, 'button:shift').index, mouse_button: 'left', click_count: 1 });
          expect(element(await look(transport), 'button:press').frame?.y).toBe(press.frame?.y);
        } finally { await transport.close(); }
      });
    });

    describe('bringing the app forward for the menu bar', () => {
      // The pointer tests above left the app in front; another app takes its place first.
      const sendToBackground = async () => {
        spawnSync('osascript', ['-e', 'tell application "Finder" to activate']);
        for (let attempt = 0; attempt < 50 && frontmost() !== 'Finder'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      };

      it('sends a Command shortcut once the app is in front', async () => {
        const transport = start();
        try {
          await sendToBackground();
          const before = await observe(transport);
          const pressed = Number(/\d+/.exec(element(before, 'text:status').title ?? '')?.[0] ?? 0);
          const { result, state } = await act(transport, { action: 'press_key', key: 'super+j', repeat: 1, chord: chord('j', ['meta']) });
          expect(result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(element(state ?? before, 'text:status').title).toBe(`Pressed ${pressed + 1}`);
          expect(frontmost()).toBe('MoxxyComputerFixture');
        } finally { await transport.close(); }
      });

      it('sends a Command shortcut to an app that has no open window', async () => {
        const transport = start();
        try {
          await observe(transport);
          await act(transport, { action: 'press_key', key: 'super+w', repeat: 1, chord: chord('w', ['meta']) });
          const closed = await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()) as { tree: { elements: unknown[] } };
          expect(closed.tree.elements).toEqual([]);
          const { result } = await act(transport, { action: 'press_key', key: 'super+n', repeat: 1, chord: chord('n', ['meta']) });
          expect(result).toEqual({ outcome: 'delivered', method: 'input' });
          expect(element(await observe(transport), 'text:status').title).toMatch(/^Pressed|^Ready/);
        } finally {
          spawnSync('osascript', ['-e', 'tell application "System Events" to tell process "MoxxyComputerFixture" to click menu item "New Window" of menu 1 of menu bar item 2 of menu bar 1']);
          await transport.close();
        }
      });

      it('pastes rich text with Command-V and gives the user their clipboard back', async () => {
        const clipboard = () => spawnSync('pbpaste').stdout.toString();
        const transport = start();
        try {
          const before = clipboard();
          await sendToBackground();
          const field = await name(transport);
          await act(transport, { action: 'set_value', element_index: field.index, value: 'x' });
          await act(transport, { action: 'select_text', element_index: field.index, text: 'x', selection_type: 'cursor_after' });
          const rich = await act(transport, { action: 'paste', text: '<b>bold</b>', format: 'html' });
          expect(rich.result).toEqual({ outcome: 'delivered', method: 'input' });
          expect((await name(transport)).value).toBe('xbold');
          expect(clipboard()).toBe(before);
        } finally { await transport.close(); }
      });
    });

    // The user stays in charge: their pause holds actions, their Escape stops, their hands keep the pointer.
    describe('the user stays in charge', () => {
      it('holds an action while paused and asks for a fresh look once resumed', async () => {
        const states: string[] = [];
        const transport = start((event) => { if (event.event === 'control_state') states.push(String(event.state)); });
        try {
          const before = await observe(transport);
          const status = element(before, 'text:status').title;
          transport.control('pause');
          const held = act(transport, { action: 'click', element_index: element(before, 'button:press').index, mouse_button: 'left', click_count: 1 });
          await new Promise((resolve) => setTimeout(resolve, 400));
          expect(states).toEqual(['paused_by_user']);
          transport.control('resume');
          const { result, state } = await held;
          expect(result).toMatchObject({ outcome: 'blocked', code: 'user_intervened' });
          expect(state && element(state, 'text:status').title).toBe(status);
          expect(states).toEqual(['paused_by_user', 'recovering']);
        } finally { await transport.close(); }
      });

      it('lets the user take over: the held key is let go, the cursor leaves and stays away until resumed', async () => {
        const cursors: unknown[] = [];
        const transport = start((event) => { if (event.event === 'cursor') cursors.push(event.cursor); });
        try {
          await observe(transport);
          const started = Date.now();
          const holding = act(transport, { action: 'hold_key', key: 'shift', duration_s: 5, chord: chord(null, ['shift']) });
          await new Promise((resolve) => setTimeout(resolve, 600));
          transport.control('takeover');
          const held = await holding;
          expect(Date.now() - started).toBeLessThan(3000);
          expect(held.state && element(held.state, 'text:keys').title).toMatch(/^Held key 56 for [0-2]\.\d s$/);
          // The model may look while the user has control; the cursor does not come back for it.
          const hidden = cursors.lastIndexOf(null);
          expect(hidden).toBeGreaterThanOrEqual(0);
          await observe(transport);
          expect(cursors.slice(hidden + 1)).toEqual([]);
          transport.control('resume');
          await observe(transport);
          expect(cursors.at(-1)).toMatchObject({ phase: 'idle' });
        } finally { await transport.close(); }
      });

      it('refuses real pointer input while the user is moving the mouse', async () => {
        const transport = start();
        // Unmarked moves at the pointer's own position: the user's hand, without moving anything on screen.
        const hand = spawn('osascript', ['-l', 'JavaScript', '-e',
          'ObjC.import("CoreGraphics"); for (let i = 0; i < 90; i++) { const at = $.CGEventGetLocation($.CGEventCreate(null)); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, at, 0)); delay(0.05); }']);
        try {
          const before = await look(transport);
          const { result, state } = await act(transport, { action: 'click', ...centre(before, 'group:pad'), mouse_button: 'left', click_count: 1 });
          expect(result).toMatchObject({ outcome: 'blocked', code: 'user_intervened' });
          expect(pad(state)).toBe(pad(before));
        } finally { stop(hand); await transport.close(); }
      });

      it('stops when the user presses Escape', async () => {
        const transport = start();
        try {
          await observe(transport);
          // Escape goes to the app in front, so the fixture takes it, not the user's work.
          spawnSync('osascript', ['-e', `tell application id "${FIXTURE}" to activate`]);
          spawnSync('osascript', ['-e', 'tell application "System Events" to key code 53']);
          for (let attempt = 0; attempt < 40 && !transport.closed; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
          expect(transport.stoppedByUser).toBe(true);
        } finally { await transport.close(); }
      });
    });

    // What a save dialog writes can run later on its own, so its destination is checked before every step.
    describe('save dialogs', () => {
      const sheet = (command: string) => spawnSync('osascript', ['-e', `tell application "System Events" to tell splitter group 1 of sheet 1 of window 1 of process "MoxxyComputerFixture" to ${command}`]);

      it('refuses to name, type or confirm a save into a protected place, and lets the user cancel', async () => {
        const transport = start();
        try {
          const opened = await act(transport, { action: 'click', element_index: element(await observe(transport), 'button:save').index, mouse_button: 'left', click_count: 1 });
          const dialog = opened.state ?? await observe(transport);
          const field = element(dialog, ':saveAsNameTextField');
          const typed = await act(transport, { action: 'type_text', element_index: field.index, text: '.zshrc' });
          expect(typed.result).toMatchObject({ outcome: 'blocked', code: 'protected_path' });
          const named = await act(transport, { action: 'set_value', element_index: field.index, value: 'authorized_keys' });
          expect(named.result).toMatchObject({ outcome: 'blocked', code: 'protected_path' });
          const fine = await act(transport, { action: 'set_value', element_index: field.index, value: 'Report' });
          expect(fine.result).toEqual({ outcome: 'delivered', method: 'ax' });
          // A name typed by someone else is still checked when the model confirms the save.
          sheet('set value of text field 1 to ".bashrc"');
          const saved = await act(transport, { action: 'click', element_index: element(dialog, ':OKButton').index, mouse_button: 'left', click_count: 1 });
          expect(saved.result).toMatchObject({ outcome: 'blocked', code: 'protected_path' });
          const cancelled = await act(transport, { action: 'click', element_index: element(saved.state ?? dialog, ':CancelButton').index, mouse_button: 'left', click_count: 1 });
          expect(element(cancelled.state ?? dialog, 'text:status').title).toBe('Not saved');
        } finally {
          sheet('click button "Cancel"');
          await transport.close();
        }
      });
    });

    describe('batches, full-screen capture and zoom', () => {
      // Brightness of one pixel of a JPEG, read through AppKit.
      const brightness = (base64: string, x: number, y: number) => {
        const file = join(mkdtempSync(join(tmpdir(), 'moxxy-shot-')), 'shot.jpg');
        writeFileSync(file, Buffer.from(base64, 'base64'));
        const script = `ObjC.import("AppKit"); const rep = $.NSBitmapImageRep.imageRepWithData($.NSData.dataWithContentsOfFile("${file}")); const c = rep.colorAtXY(${x}, ${y}); c.redComponent + c.greenComponent + c.blueComponent`;
        return Number(spawnSync('osascript', ['-l', 'JavaScript', '-e', script]).stdout.toString().trim());
      };

      it('runs steps until the first one that is not delivered and returns the state once', async () => {
        const transport = start();
        try {
          const before = await observe(transport);
          // The fixture counts presses for its whole life; earlier tests may have left another status.
          const pressed = /^Pressed (\d+)$/.exec(element(before, 'text:status').title ?? '');
          const actions = [
            { action: 'click', element_index: element(before, 'button:press').index, mouse_button: 'left', click_count: 1 },
            { action: 'set_value', element_index: element(before, 'text field:name').index, value: 'batched' },
            { action: 'click', element_index: 9999, mouse_button: 'left', click_count: 1 },
            { action: 'set_value', element_index: element(before, 'text field:name').index, value: 'never' },
          ];
          const { results, state } = batchResultSchema.parse(await transport.request('batch', { app: FIXTURE, actions, allowed: [FIXTURE] }, signal()));
          expect(results).toEqual([{ outcome: 'delivered', method: 'ax' }, { outcome: 'delivered', method: 'ax' }, { outcome: 'blocked', code: 'stale_state' }]);
          const status = element(state ?? before, 'text:status').title ?? '';
          expect(status).toMatch(/^Pressed \d+$/);
          if (pressed) expect(status).toBe(`Pressed ${Number(pressed[1]) + 1}`);
          expect(element(state ?? before, 'text field:name').value).toBe('batched');
          await expect(transport.request('batch', { app: FIXTURE, actions, allowed: ['com.apple.TextEdit'] }, signal())).rejects.toMatchObject({ code: 'app_not_allowed' });
        } finally { await transport.close(); }
      });

      it('captures the display with only granted apps visible, within the image budget', async () => {
        const transport = start();
        try {
          await expect(transport.request('zoom', { region: [0, 0, 10, 10], allowed: [FIXTURE] }, signal())).rejects.toMatchObject({ code: 'no_state' });
          await observe(transport);
          const shot = imageSchema.parse(await transport.request('screenshot', { allowed: [FIXTURE] }, signal()));
          const [width, height] = imageBudget(shot.width, shot.height);
          expect([shot.width, shot.height]).toEqual([width, height]);
          // The menu bar and every other app stay out: the top edge right of the window is empty.
          expect(brightness(shot.base64, shot.width - 5, 5)).toBeLessThan(0.05);
          // The granted window stays where it is on screen, so the image maps to screen points.
          const [screenWidth, x, y, w, h] = spawnSync('osascript', ['-l', 'JavaScript', '-e',
            'ObjC.import("AppKit"); const se = Application("System Events"); const win = se.processes.byName("MoxxyComputerFixture").windows[0]; const [x, y] = win.position(); const [w, h] = win.size(); [$.NSScreen.mainScreen.frame.size.width, x, y, w, h].join(",")',
          ]).stdout.toString().trim().split(',').map(Number);
          const ratio = shot.width / (screenWidth ?? NaN);
          expect(brightness(shot.base64, Math.round(((x ?? 0) + (w ?? 0) / 2) * ratio), Math.round(((y ?? 0) + (h ?? 0) / 2) * ratio))).toBeGreaterThan(0.1);
          const half = imageSchema.parse(await transport.request('screenshot', { allowed: [FIXTURE], scale: 0.5 }, signal()));
          expect(half.width).toBe(Math.round(shot.width / 2));
          const zoomed = imageSchema.parse(await transport.request('zoom', { region: [0, 0, 100, 50], allowed: [FIXTURE] }, signal()));
          expect(zoomed.width / zoomed.height).toBeCloseTo(2, 1);
        } finally { await transport.close(); }
      });

      it('zooms into a region of the app screenshot at a closer look and refuses one outside it', async () => {
        const transport = start();
        try {
          const state = await look(transport);
          const { frame } = element(state, 'button:press');
          if (!frame || !state.screenshot) throw new Error('no frame');
          const region = [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height];
          const zoomed = imageSchema.parse(await transport.request('zoom', { region, app: FIXTURE, allowed: [FIXTURE] }, signal()));
          // Native resolution: at least as many pixels as the region had in the screenshot.
          expect(zoomed.width).toBeGreaterThanOrEqual(frame.width);
          const outside = [0, 0, state.screenshot.width + 1, 10];
          await expect(transport.request('zoom', { region: outside, app: FIXTURE, allowed: [FIXTURE] }, signal())).rejects.toMatchObject({ code: 'point_outside_frame' });
          await expect(transport.request('zoom', { region, app: FIXTURE, allowed: [] }, signal())).rejects.toMatchObject({ code: 'app_not_allowed' });
        } finally { await transport.close(); }
      });
    });

    describe('live preview for the human', () => {
      type Preview = { event: string; seq: number; image?: { mediaType: string; base64: string; width: number; height: number }; error?: string };
      const until = async (done: () => boolean, ms: number) => {
        const deadline = Date.now() + ms;
        while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        return done();
      };

      it('streams the observed window as small JPEG frames, follows changes, keeps saying it is alive, and stops', async () => {
        const previews: Preview[] = [];
        const transport = start((event) => { if (event.event === 'preview_frame') previews.push(event as unknown as Preview); });
        const pictures = () => previews.filter((preview) => preview.image);
        try {
          const before = await observe(transport);
          await transport.request('preview.start', { fps: 5 }, signal());
          expect(await until(() => pictures().length > 0, 5000)).toBe(true);
          const first = pictures()[0];
          expect(first?.image?.mediaType).toBe('image/jpeg');
          expect(Buffer.from(first?.image?.base64 ?? '', 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
          expect(Math.max(first?.image?.width ?? 0, first?.image?.height ?? 0)).toBeLessThanOrEqual(960);
          expect(previews.every((preview) => preview.error === undefined)).toBe(true);

          const seen = pictures().length;
          await act(transport, { action: 'click', element_index: element(before, 'button:press').index, mouse_button: 'left', click_count: 1 });
          expect(await until(() => pictures().length > seen, 5000)).toBe(true);
          expect(pictures().at(-1)?.image?.base64).not.toBe(first?.image?.base64);
          const sequence = previews.map((preview) => preview.seq);
          expect(sequence).toEqual([...sequence].sort((a, b) => a - b));

          // A window that does not change still reports that capture is running.
          const quiet = previews.length;
          expect(await until(() => previews.slice(quiet).some((preview) => !preview.image), 4000)).toBe(true);

          await transport.request('preview.stop', {}, signal());
          const stopped = previews.length;
          await new Promise((resolve) => setTimeout(resolve, 1500));
          expect(previews.length).toBe(stopped);
        } finally { await transport.close(); }
      });

      it('streams the window as H.264 when asked: a key frame first, and a new one on request', async () => {
        type Chunk = { event: string; seq: number; key: boolean; codec: string; data: string; width: number; height: number; timestamp: number };
        const chunks: Chunk[] = [];
        const pictures: Preview[] = [];
        const transport = start((event) => {
          if (event.event === 'preview_chunk') chunks.push(event as unknown as Chunk);
          if (event.event === 'preview_frame') pictures.push(event as unknown as Preview);
        });
        try {
          await observe(transport);
          await transport.request('preview.start', { fps: 5, codec: 'h264' }, signal());
          expect(await until(() => chunks.length > 0, 5000)).toBe(true);
          const first = chunks[0];
          expect(first?.key).toBe(true);
          expect(first?.codec).toMatch(/^avc1\.[0-9a-f]{6}$/);
          const bytes = Buffer.from(first?.data ?? '', 'base64');
          expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 1]));
          // The stream starts with its sequence parameter set, so a decoder needs nothing else.
          expect((bytes[4] ?? 0) & 0x1f).toBe(7);
          expect(Math.max(first?.width ?? 0, first?.height ?? 0)).toBeLessThanOrEqual(960);
          expect((first?.width ?? 1) % 2).toBe(0);

          // The window is still, so nothing new is encoded until a viewer needs to start decoding.
          const seen = chunks.length;
          await transport.request('preview.keyframe', {}, signal());
          expect(await until(() => chunks.slice(seen).some((chunk) => chunk.key), 5000)).toBe(true);
          expect(chunks.map((chunk) => chunk.seq)).toEqual([...chunks.map((chunk) => chunk.seq)].sort((a, b) => a - b));
          // Video replaces the pictures; only "still running" frames without a picture remain.
          expect(pictures.filter((preview) => preview.image)).toEqual([]);

          await expect(transport.request('preview.start', { codec: 'vp9' }, signal())).rejects.toMatchObject({ code: 'invalid_params' });
          await transport.request('preview.stop', {}, signal());
        } finally { await transport.close(); }
      });

      it('starts capturing once a window is observed when the preview was asked for first', async () => {
        const previews: Preview[] = [];
        const transport = start((event) => { if (event.event === 'preview_frame') previews.push(event as unknown as Preview); });
        try {
          await transport.request('preview.start', {}, signal());
          await new Promise((resolve) => setTimeout(resolve, 500));
          expect(previews.filter((preview) => preview.image)).toEqual([]);
          await observe(transport);
          expect(await until(() => previews.some((preview) => preview.image), 5000)).toBe(true);
        } finally { await transport.close(); }
      });
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
