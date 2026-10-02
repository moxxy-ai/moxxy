import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageBudget } from '../contract/image.js';
import { verifyHelperArtifact } from '../helper/artifact.js';
import { HelperTransport, type HelperEvent } from '../helper/transport.js';
import { CONTRACT_PROTOCOL_VERSION, actResultSchema, appStateSchema, contractEventsFor, imageSchema, listAppsResultSchema, resolveAppsResultSchema, statusResultSchema, type AppState } from '../backend/rpc.js';
import { REQUEST_ACCESS_TOOL } from '../backend/access.js';
import { ComputerBackend } from '../backend/backend.js';
import { memoryLog, toolContext } from '../backend/helper.fixture.js';
import type { MoxxyEvent, ToolImageResult } from '@moxxy/sdk';
import { computerTools } from '../contract/tools.js';
import { createComputerControlPlugin } from '../index.js';
import { linuxHelperPath, linuxProfile, type LinuxArchitecture } from './profile.js';

// Drives the real helper built by native/linux/build.sh inside an X11 desktop (native/linux/desktop.sh);
// other hosts, unbuilt trees and sessions without a display skip.
const arch = process.arch as LinuxArchitecture;
const helper = process.platform === 'linux' && (arch === 'x64' || arch === 'arm64') ? linuxHelperPath(arch) : '';
const built = helper !== '' && existsSync(helper) && Boolean(process.env.DISPLAY);
const fixtureBinary = fileURLToPath(new URL(`../../native/linux/build/${arch}/moxxy-computer-fixture`, import.meta.url));
const fixtureBuilt = built && existsSync(fixtureBinary);
const FIXTURE = 'ai.moxxy.computer-fixture';

const signal = () => new AbortController().signal;
const start = (onEvent?: (event: HelperEvent) => void) => new HelperTransport(helper, ['--parent', String(process.pid)], {
  protocolVersion: CONTRACT_PROTOCOL_VERSION, events: contractEventsFor(CONTRACT_PROTOCOL_VERSION), timeoutMs: 30_000, ...(onEvent ? { onEvent } : {}),
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(done: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await sleep(50);
  return done();
}
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`no exit within ${ms} ms`)), ms).unref());
}
function stop(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

describe.skipIf(!built)('Linux native helper', () => {
  it('is a verified ELF artifact for the shared protocol', async () => {
    await expect(verifyHelperArtifact(helper, CONTRACT_PROTOCOL_VERSION)).resolves.toBeUndefined();
  });

  it('reports a ready X11 desktop with the accessibility bus', async () => {
    const transport = start();
    try {
      const status = statusResultSchema.parse(await transport.request('status', {}, signal()));
      expect(status).toEqual({ ready: true, permissions: { accessibility: true, screenRecording: true }, limitations: [] });
    } finally { await transport.close(); }
  });

  it('says why it cannot work in a Wayland session', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    const transport = start();
    delete process.env.WAYLAND_DISPLAY;
    try {
      const status = statusResultSchema.parse(await transport.request('status', {}, signal()));
      expect(status.ready).toBe(false);
      expect(status.limitations.join(' ')).toContain('Wayland');
    } finally { await transport.close(); }
  });

  it('is what the plugin runs on Linux: the shared tools, with a status answered by the helper', async () => {
    const plugin = createComputerControlPlugin();
    expect((plugin.tools ?? []).map((tool) => tool.name).sort()).toEqual(Object.keys(computerTools).sort());
    const status = plugin.tools?.find((tool) => tool.name === 'computer_status');
    try {
      const report = await status?.handler({}, toolContext(memoryLog([]), { sessionId: 'plugin-status' })) as { platform: string; ready: boolean };
      expect(report).toMatchObject({ platform: 'linux', ready: true });
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

  it('exits as soon as its input closes', async () => {
    const transport = start();
    await transport.request('status', {}, signal());
    const started = performance.now();
    await transport.close();
    expect(performance.now() - started).toBeLessThan(450);
  });

  it('exits when the process it serves dies', async () => {
    const parent = spawn('/bin/sleep', ['30']);
    const child = spawn(helper, ['--parent', String(parent.pid)], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const exited = once(child, 'exit');
      await sleep(300);
      parent.kill('SIGKILL');
      const [code] = await Promise.race([exited, timeout(2000)]);
      expect(code).toBe(0);
    } finally { stop(child); stop(parent); }
  });

  it('refuses to start without the process it serves', async () => {
    const child = spawn(helper, [], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const [code] = await Promise.race([once(child, 'exit'), timeout(2000)]);
      expect(code).toBe(64);
    } finally { stop(child); }
  });
});

const quitFixture = async () => {
  spawnSync('pkill', ['-f', 'moxxy-computer-fixture']);
  for (let attempt = 0; attempt < 50 && spawnSync('pgrep', ['-f', 'moxxy-computer-fixture']).status === 0; attempt += 1) await sleep(100);
};

type Element = AppState['tree']['elements'][number];
const named = (state: AppState, role: string, title: string): Element => {
  const element = state.tree.elements.find((candidate) => candidate.role === role && candidate.title === title);
  if (!element) throw new Error(`no ${role} "${title}" in:\n${state.tree.elements.map((candidate) => `${candidate.role} ${candidate.title ?? ''} ${candidate.value ?? ''}`).join('\n')}`);
  return element;
};
const says = (state: AppState, text: string) => state.tree.elements.some((element) => element.title === text);
const centre = (element: Element) => {
  if (!element.frame) throw new Error(`${element.role} has no frame`);
  return { x: Math.round(element.frame.x + element.frame.width / 2), y: Math.round(element.frame.y + element.frame.height / 2) };
};
const observe = async (transport: HelperTransport) =>
  appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: true }, signal()));
const act = async (transport: HelperTransport, action: Record<string, unknown>) => {
  const answer = actResultSchema.parse(await transport.request('act', { app: FIXTURE, action, allowed: [FIXTURE] }, signal()));
  if (!answer.state) throw new Error('an action returns the fresh state');
  return { result: answer.result, state: answer.state };
};

describe.skipIf(!fixtureBuilt)('Linux Computer Use on the fixture app', () => {
  beforeAll(async () => {
    // The fixture is installed for this run only, the way a desktop file installs any app.
    const data = mkdtempSync(join(tmpdir(), 'moxxy-computer-'));
    mkdirSync(join(data, 'applications'));
    writeFileSync(join(data, 'applications', `${FIXTURE}.desktop`),
      `[Desktop Entry]\nType=Application\nName=Moxxy Computer Fixture\nExec=${fixtureBinary}\n`);
    process.env.XDG_DATA_HOME = data;
    await quitFixture();
  });
  afterAll(quitFixture);

  it('lists and resolves installed apps in the contract shape', async () => {
    const transport = start();
    try {
      const listed = listAppsResultSchema.parse(await transport.request('list_apps', { query: 'moxxy computer', limit: 5 }, signal()));
      expect(listed.apps).toEqual([{ id: FIXTURE, name: 'Moxxy Computer Fixture', running: false }]);
      const resolved = resolveAppsResultSchema.parse(await transport.request('resolve_apps', { names: ['Moxxy Computer Fixture', 'No Such App 1234'] }, signal()));
      expect(resolved.apps).toEqual([
        { request: 'Moxxy Computer Fixture', status: 'resolved', id: FIXTURE, name: 'Moxxy Computer Fixture' },
        { request: 'No Such App 1234', status: 'not_found' },
      ]);
      await expect(transport.request('get_app_state', { app: 'no.such.app', screenshot: false }, signal())).rejects.toMatchObject({ code: 'app_not_found' });
    } finally { await transport.close(); }
  });

  it('launches the app, waits for it to load and returns its indexed accessibility tree', async () => {
    const transport = start();
    try {
      const state = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      expect(state.tree).toMatchObject({ app: 'Moxxy Computer Fixture', window: 'Moxxy Fixture' });
      expect(named(state, 'text', 'Name').value).toBe('hello');
      expect(named(state, 'push button', 'Press')).toBeDefined();
      expect(named(state, 'check box', 'Remember').states).toContain('checked');
      expect(named(state, 'push button', 'Disabled').states).toContain('disabled');
      expect(named(state, 'spin button', 'Amount').value).toBe('3');
      const secret = named(state, 'password text', 'Secret');
      expect(secret).toMatchObject({ secure: true });
      expect(secret.value).toBeUndefined();
      expect(JSON.stringify(state)).not.toContain('hunter2');
      expect(says(state, 'Loaded')).toBe(true);
      const listed = listAppsResultSchema.parse(await transport.request('list_apps', { query: 'moxxy computer', limit: 5 }, signal()));
      expect(listed.apps[0]).toMatchObject({ id: FIXTURE, running: true });
    } finally { await transport.close(); }
  });

  it('keeps every element index across observations', async () => {
    const transport = start();
    try {
      const first = await observe(transport);
      const second = await observe(transport);
      const indices = (state: AppState) => Object.fromEntries(state.tree.elements.map((element) => [element.key, element.index]));
      expect(indices(second)).toEqual(indices(first));
    } finally { await transport.close(); }
  });

  it('captures the window within the image budget and places elements in its pixels', async () => {
    const events: HelperEvent[] = [];
    const transport = start((event) => events.push(event));
    try {
      const state = await observe(transport);
      const shot = state.screenshot;
      expect(shot?.mediaType).toBe('image/jpeg');
      expect(Buffer.from(shot?.base64 ?? '', 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      const width = shot?.width ?? 0;
      const height = shot?.height ?? 0;
      expect(imageBudget(width, height)).toEqual([width, height]);
      const frame = named(state, 'push button', 'Press').frame ?? { x: -1, y: -1, width: 0, height: 0 };
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(height);
      expect(frame.width).toBeGreaterThan(10);
      expect(events).toContainEqual({ version: CONTRACT_PROTOCOL_VERSION, event: 'cursor', cursor: { phase: 'idle', x: 0.5, y: 0.5 } });
    } finally { await transport.close(); }
  });

  it('refuses to act on an app that is not granted or was not observed', async () => {
    const transport = start();
    try {
      const click = { action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 };
      await expect(transport.request('act', { app: FIXTURE, action: click, allowed: [] }, signal())).rejects.toMatchObject({ code: 'app_not_allowed' });
      const answer = actResultSchema.parse(await transport.request('act', { app: FIXTURE, action: click, allowed: [FIXTURE] }, signal()));
      expect(answer.result).toEqual({ outcome: 'blocked', code: 'no_state' });
    } finally { await transport.close(); }
  });

  it('presses a button through accessibility, shows the cursor at work and returns the new state', async () => {
    const events: HelperEvent[] = [];
    const transport = start((event) => { if (event.event === 'cursor') events.push(event); });
    try {
      const state = await observe(transport);
      const pressed = await act(transport, { action: 'click', element_index: named(state, 'push button', 'Press').index, mouse_button: 'left', click_count: 1 });
      expect(pressed.result).toEqual({ outcome: 'delivered', method: 'ax' });
      expect(pressed.state.tree.elements.some((element) => element.title?.startsWith('Pressed '))).toBe(true);
      const phases = events.map((event) => (event as { cursor: { phase: string } | null }).cursor?.phase);
      expect(phases).toEqual(expect.arrayContaining(['moving', 'executing', 'delivered']));
    } finally { await transport.close(); }
  });

  it('presses a control under a screenshot point through accessibility too', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      const before = state.tree.elements.find((element) => element.title?.startsWith('Pressed '))?.title;
      const pressed = await act(transport, { action: 'click', ...centre(named(state, 'push button', 'Press')), mouse_button: 'left', click_count: 1 });
      expect(pressed.result).toEqual({ outcome: 'delivered', method: 'ax' });
      expect(pressed.state.tree.elements.find((element) => element.title?.startsWith('Pressed '))?.title).not.toBe(before);
    } finally { await transport.close(); }
  });

  it('types into a field and sets values without touching the keyboard', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      const typed = await act(transport, { action: 'type_text', element_index: named(state, 'text', 'Name').index, text: ' wörld' });
      expect(typed.result).toEqual({ outcome: 'delivered', method: 'ax' });
      expect(named(typed.state, 'text', 'Name').value).toContain(' wörld');
      const set = await act(transport, { action: 'set_value', element_index: named(typed.state, 'text', 'Name').index, value: 'replaced' });
      expect(set.result).toEqual({ outcome: 'delivered', method: 'ax' });
      expect(named(set.state, 'text', 'Name').value).toBe('replaced');
      const amount = await act(transport, { action: 'set_value', element_index: named(set.state, 'spin button', 'Amount').index, value: '7' });
      expect(named(amount.state, 'spin button', 'Amount').value).toBe('7');
      const refused = await act(transport, { action: 'type_text', element_index: named(amount.state, 'push button', 'Press').index, text: 'x' });
      expect(refused.result).toMatchObject({ outcome: 'unsupported', code: 'unsupported_action' });
    } finally { await transport.close(); }
  });

  it('types with real keys into whatever has focus, in any script', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      await act(transport, { action: 'set_value', element_index: named(state, 'text', 'Name').index, value: '' });
      const field = centre(named(state, 'text', 'Name'));
      await act(transport, { action: 'click', ...field, mouse_button: 'left', click_count: 1 });
      const secret = await act(transport, { action: 'type_text', text: 'Zażółć 1+2' });
      expect(named(secret.state, 'text', 'Name').value).toBe('Zażółć 1+2');
    } finally { await transport.close(); }
  });

  it('clicks, scrolls and drags on a canvas that has no elements, and gives the pointer back', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      const pad = named(state, 'drawing area', 'Pad');
      const point = centre(pad);
      spawnSync('xdotool', ['mousemove', '5', '5']);
      await sleep(600);
      const clicked = await act(transport, { action: 'click', ...point, mouse_button: 'left', click_count: 1 });
      expect(clicked.result).toEqual({ outcome: 'delivered', method: 'input' });
      expect(says(clicked.state, 'click button 1')).toBe(true);
      expect(spawnSync('xdotool', ['getmouselocation']).stdout.toString()).toContain('x:5 y:5');
      const right = await act(transport, { action: 'click', ...point, mouse_button: 'right', click_count: 1, held: ['shift'] });
      expect(says(right.state, 'click button 3 shift')).toBe(true);
      const double = await act(transport, { action: 'click', ...point, mouse_button: 'left', click_count: 2 });
      expect(says(double.state, 'double button 1')).toBe(true);
      const scrolled = await act(transport, { action: 'scroll', ...point, direction: 'down', pages: 1 });
      expect(scrolled.result).toEqual({ outcome: 'delivered', method: 'input' });
      expect(scrolled.state.tree.elements.some((element) => element.title?.startsWith('scroll down '))).toBe(true);
      const dragged = await act(transport, { action: 'drag', path: [[point.x - 100, point.y], [point.x + 100, point.y + 40]], duration_ms: 300, mouse_button: 'left' });
      expect(dragged.result).toEqual({ outcome: 'delivered', method: 'input' });
      expect(says(dragged.state, 'drag right down')).toBe(true);
    } finally { await transport.close(); }
  });

  it('sends key chords to the app', async () => {
    const transport = start();
    try {
      await observe(transport);
      const pressed = await act(transport, { action: 'press_key', chord: { modifiers: ['ctrl'], key: 'k' }, repeat: 1 });
      expect(pressed.result).toEqual({ outcome: 'delivered', method: 'input' });
      expect(says(pressed.state, 'key ctrl+k')).toBe(true);
    } finally { await transport.close(); }
  });

  it('gives a control that ignores an accessibility press a real click when asked again', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      const click = { action: 'click', element_index: named(state, 'push button', 'Stubborn 0').index, mouse_button: 'left', click_count: 1 };
      const first = await act(transport, click);
      expect(first.result).toEqual({ outcome: 'delivered', method: 'ax' });
      expect(says(first.state, 'Stubborn 0')).toBe(true);
      const second = await act(transport, click);
      expect(second.result).toEqual({ outcome: 'delivered', method: 'input' });
      expect(says(second.state, 'Stubborn 1')).toBe(true);
    } finally { await transport.close(); }
  });

  it('refuses a point outside the screenshot and an index from an older state', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      const outside = await act(transport, { action: 'click', x: (state.screenshot?.width ?? 0) + 50, y: 10, mouse_button: 'left', click_count: 1 });
      expect(outside.result).toMatchObject({ outcome: 'blocked', code: 'point_outside_frame' });
      const stale = await act(transport, { action: 'click', element_index: 4999, mouse_button: 'left', click_count: 1 });
      expect(stale.result).toMatchObject({ outcome: 'blocked', code: 'stale_state' });
    } finally { await transport.close(); }
  });

  it('zooms into a region of the latest screenshot', async () => {
    const transport = start();
    try {
      const state = await observe(transport);
      const frame = named(state, 'push button', 'Press').frame ?? { x: 0, y: 0, width: 10, height: 10 };
      const region = [Math.floor(frame.x), Math.floor(frame.y), Math.ceil(frame.x + frame.width), Math.ceil(frame.y + frame.height)];
      const image = imageSchema.parse(await transport.request('zoom', { region, app: FIXTURE, allowed: [FIXTURE] }, signal()));
      expect(image.width).toBeGreaterThan(10);
      await expect(transport.request('zoom', { region: [0, 0, 9000, 9000], app: FIXTURE, allowed: [FIXTURE] }, signal())).rejects.toMatchObject({ code: 'point_outside_frame' });
    } finally { await transport.close(); }
  });

  it('holds an action while the user has paused, then does nothing with it', async () => {
    const states: string[] = [];
    const transport = start((event) => { if (event.event === 'control_state') states.push(event.state); });
    try {
      const state = await observe(transport);
      transport.control('pause');
      await sleep(100);
      const waiting = act(transport, { action: 'click', element_index: named(state, 'push button', 'Press').index, mouse_button: 'left', click_count: 1 });
      expect(await until(() => states.includes('paused_by_user'), 2000)).toBe(true);
      transport.control('resume');
      expect((await waiting).result).toMatchObject({ outcome: 'blocked', code: 'user_intervened' });
      expect(states).toEqual(['paused_by_user', 'recovering']);
    } finally { await transport.close(); }
  });

  it('takes the cursor away when the user takes over and brings it back on resume', async () => {
    const cursors: unknown[] = [];
    const transport = start((event) => { if (event.event === 'cursor') cursors.push(event.cursor); });
    try {
      await observe(transport);
      transport.control('takeover');
      expect(await until(() => cursors.at(-1) === null, 2000)).toBe(true);
      await observe(transport);
      expect(cursors.at(-1)).toBeNull();
      transport.control('resume');
      expect(await until(() => cursors.at(-1) !== null, 2000)).toBe(true);
      expect(cursors.at(-1)).toMatchObject({ phase: 'idle' });
    } finally { await transport.close(); }
  });

  it("stops when the user presses Escape, and not for the agent's own Escape", async () => {
    const child = spawn(helper, ['--parent', String(process.pid)], { stdio: ['pipe', 'pipe', 'ignore'] });
    try {
      const send = (frame: unknown) => child.stdin.write(`${JSON.stringify(frame)}\n`);
      const lines: string[] = [];
      child.stdout.on('data', (chunk: Buffer) => lines.push(...chunk.toString().split('\n').filter(Boolean)));
      const answered = (id: string) => until(() => lines.some((line) => (JSON.parse(line) as { id?: string; ok?: boolean }).id === id), 15_000);
      send({ version: CONTRACT_PROTOCOL_VERSION, id: 'a', method: 'get_app_state', params: { app: FIXTURE, screenshot: false } });
      expect(await answered('a')).toBe(true);
      send({ version: CONTRACT_PROTOCOL_VERSION, id: 'b', method: 'act', params: { app: FIXTURE, allowed: [FIXTURE], action: { action: 'press_key', chord: { modifiers: [], key: 'escape' }, repeat: 1 } } });
      expect(await answered('b')).toBe(true);
      expect(child.exitCode).toBeNull();
      await sleep(400);
      spawnSync('xdotool', ['key', 'Escape']);
      const [code] = await Promise.race([once(child, 'exit'), timeout(3000)]);
      expect(code).toBe(20);
    } finally { stop(child); }
  });

  it('streams pictures of the window in use for the human, and stops', async () => {
    const previews: Array<{ seq: number; image?: unknown; error?: string }> = [];
    const transport = start((event) => { if (event.event === 'preview_frame') previews.push(event); });
    try {
      const state = await observe(transport);
      await transport.request('preview.start', { fps: 5 }, signal());
      expect(await until(() => previews.some((preview) => preview.image), 3000)).toBe(true);
      const quiet = previews.length;
      // A still window is not sent again; it only says it is still watched.
      expect(await until(() => previews.slice(quiet).some((preview) => !preview.image), 4000)).toBe(true);
      const pictures = previews.filter((preview) => preview.image).length;
      await act(transport, { action: 'click', element_index: named(state, 'push button', 'Press').index, mouse_button: 'left', click_count: 1 });
      expect(await until(() => previews.filter((preview) => preview.image).length > pictures, 3000)).toBe(true);
      expect(previews.every((preview) => preview.error === undefined)).toBe(true);
      expect(previews.map((preview) => preview.seq)).toEqual(previews.map((_, index) => index));
      await expect(transport.request('preview.start', { codec: 'h264' }, signal())).rejects.toMatchObject({ code: 'invalid_params' });
      await transport.request('preview.stop', {}, signal());
      const stopped = previews.length;
      await sleep(600);
      expect(previews.length).toBe(stopped);
    } finally { await transport.close(); }
  });

  it('serves the model tools end to end through the shared backend', { timeout: 60_000 }, async () => {
    const backend = new ComputerBackend(linuxProfile(arch));
    const tools = new Map(backend.tools().map((tool) => [tool.name, tool]));
    const events: MoxxyEvent[] = [];
    const run = async (name: string, input: unknown, callId = 'c') => {
      const tool = tools.get(name);
      if (!tool) throw new Error(name);
      return tool.handler(tool.inputSchema.parse(input), toolContext(memoryLog(events), { callId }));
    };
    try {
      const request = { apps: ['Moxxy Computer Fixture'], reason: 'Integration test' };
      const base = { id: 'e', seq: 0, ts: 0, sessionId: 'session', turnId: 'turn', source: 'system' };
      events.push({ ...base, type: 'tool_call_requested', callId: 'grant', name: REQUEST_ACCESS_TOOL, input: request } as MoxxyEvent);
      events.push({ ...base, type: 'tool_call_approved', callId: 'grant', decidedBy: 'resolver', mode: 'allow' } as MoxxyEvent);
      const grant = await run(REQUEST_ACCESS_TOOL, request, 'grant');
      events.push({ ...base, type: 'tool_result', callId: 'grant', ok: true, output: grant } as MoxxyEvent);
      expect(grant).toMatchObject({ granted: [{ id: FIXTURE, name: 'Moxxy Computer Fixture', tier: 'full' }] });
      const state = await run('computer_get_app_state', { app: FIXTURE }) as ToolImageResult;
      expect(state.mediaType).toBe('image/jpeg');
      expect(state.forModel).toContain('<app_content app="Moxxy Computer Fixture" trust="untrusted">');
      expect(state.forModel).not.toContain('hunter2');
      expect((await backend.controls.forSession('session').snapshot())[0]).toMatchObject({
        cursor: { phase: 'idle' }, target: { app: 'Moxxy Computer Fixture', window: 'Moxxy Fixture' },
      });
      const press = Number(/\[(\d+)\] push button "Press"/.exec(state.forModel ?? '')?.[1]);
      const clicked = await run('computer_click', { app: FIXTURE, element_index: press }) as ToolImageResult;
      expect(clicked.forModel).toContain('Action delivered');
      expect(clicked.forModel).toMatch(/label "Pressed \d+"/);
    } finally { await backend.release('session'); }
  });
});
