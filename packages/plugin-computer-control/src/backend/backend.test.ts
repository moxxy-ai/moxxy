import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTO_APPROVE_PLUGIN_ID, AUTO_APPROVE_SUBTYPE, type AppContext, type ComputerControlService, type MoxxyEvent, type ToolDef, type ToolImageResult } from '@moxxy/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_ACCESS_TOOL } from './access.js';
import type { AppHint } from './app-hints.js';
import { ComputerBackend, type PlatformProfile } from './backend.js';
import { contractHelperScript, helperRequests, memoryLog, toolContext } from './helper.fixture.js';
import type { PreviewMessage } from '../preview/controller.js';
import { CONTRACT_PROTOCOL_VERSION } from './rpc.js';
import type { AskJev, JevAnswers } from '@moxxy/jev';
import { RunMemory } from '../jev/memory.js';

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

function backend(hints: AppHint[] = [], extra: Partial<PlatformProfile> = {}, jev?: (apiKey: string) => AskJev): { instance: ComputerBackend; tools: Map<string, ToolDef> } {
  const instance = new ComputerBackend(profile(extra), hints, jev, new RunMemory(join(directory, 'learned'), Date.now, join(directory, 'shipped')));
  backends.push(instance);
  return { instance, tools: new Map(instance.tools().map((tool) => [tool.name, tool])) };
}

let seq = 0;
const base = (turnId: string) => ({ id: `e${seq}`, seq: seq++, ts: 0, sessionId: 'session', turnId, source: 'system' });

async function run(tools: Map<string, ToolDef>, name: string, input: unknown, turnId = 'turn', secrets: Record<string, string> = {}): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(tool.inputSchema.parse(input), toolContext(memoryLog(events), { turnId, getSecret: async (secret) => secrets[secret] ?? null }));
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

describe('an app asked for under another name', () => {
  // The system's name for an app can differ from the one the model used ("System Settings" is "Ustawienia systemowe").
  it('is known by the name it was asked for, not only by the name it was granted under', async () => {
    const { tools } = backend();
    const output = await requestAccess(tools, { apps: ['Text Editor'], reason: 'Edit a note' }) as { granted: unknown[] };
    expect(output.granted).toEqual([{ id: 'com.apple.TextEdit', name: 'TextEdit', tier: 'full' }]);
    expect(forModel(await run(tools, 'computer_get_app_state', { app: 'Text Editor' }))).toContain('App: TextEdit');
  });

  it('stays refused when it was never granted', async () => {
    const { tools } = backend();
    await requestAccess(tools, { apps: ['Text Editor'], reason: 'Edit a note' });
    await expect(run(tools, 'computer_get_app_state', { app: 'Safari' })).rejects.toThrow(/not granted/);
  });
});

describe('observation', () => {
  it('marks the tools that only look as live state, so the loop guard lets them repeat between actions', () => {
    const { tools } = backend();
    const live = [...tools.values()].filter((tool) => tool.liveState).map((tool) => tool.name).sort();
    expect(live).toEqual(['computer_get_app_state', 'computer_list_apps', 'computer_status', 'computer_zoom']);
  });

  it('keeps the two tools a task starts with loaded, so a long tool list costs no round to load them', () => {
    const { tools } = backend();
    const loaded = [...tools.values()].filter((tool) => tool.alwaysLoaded).map((tool) => tool.name).sort();
    expect(loaded).toEqual(['computer_request_access', 'computer_run']);
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

describe('a run of steps', () => {
  /** Jev that finds an element by a word of its line and believes every expectation. */
  const jev = (keys: string[]) => (apiKey: string): AskJev => async (state, questions) => {
    keys.push(apiKey);
    const { elements, step } = state as { elements: string; step?: { target?: string } };
    const line = elements.split('\n').find((candidate) => step?.target !== undefined && candidate.includes(step.target));
    const index = line ? (/\[(\d+)\]/.exec(line) ?? [])[1] ?? 'none' : 'none';
    return Object.fromEntries(Object.entries(questions).map(([id, question]) =>
      [id, question.type === 'choice' ? { type: 'choice', choice: index, probabilities: { [index]: 0.9 }, confidence: 0.9 } : { type: 'noul', noul: id === 'expected' ? 0.9 : 0 }])) as JevAnswers;
  };
  const steps = [{ do: 'type', target: 'text area', text: ' world', expect: 'the text ends with world' }, { do: 'key', key: 'Return' }];

  it('carries out the steps through the helper with the key from the vault, and returns the report with the fresh state', async () => {
    const keys: string[] = [];
    const { tools } = backend([], {}, jev(keys));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    const output = forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Add a word', steps }, 'turn', { TYPESAFE_API_KEY: 'vault-key' }));
    expect(output).toMatch(/computer_run: 2 of 2 steps done/);
    expect(output).toContain('1. verified — type "text area" " world" → [1] text area value="hello" focused');
    expect(output).toContain('[1] text area value="hello world" focused');
    expect(new Set(keys)).toEqual(new Set(['vault-key']));
    expect(helperRequests(requestsFile).filter((request) => request.method === 'act').map((request) => request.params.action)).toEqual([
      { action: 'type_text', element_index: 1, text: ' world' },
      { action: 'press_key', key: 'Return', repeat: 1, chord: { modifiers: [], key: 'enter' } },
    ]);
  });

  it('clicks what the screenshot reads as the target when no element is named so', async () => {
    const { tools } = backend([], {}, jev([]));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Publish', steps: [{ do: 'click', target: 'Publish' }] }, 'turn', { TYPESAFE_API_KEY: 'vault-key' });
    const sent = helperRequests(requestsFile);
    expect(sent.find((request) => request.method === 'read_text')?.params).toEqual({ app: 'com.apple.TextEdit', allowed: ['com.apple.TextEdit'] });
    expect(sent.filter((request) => request.method === 'act').map((request) => request.params.action)).toEqual([
      expect.objectContaining({ action: 'click', x: 330, y: 50 }),
    ]);
  });

  it('without a TypeSafe key answers with the state and no error, and touches nothing', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    try {
      const { tools } = backend([], {}, jev([]));
      await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
      const output = forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Add a word', steps }));
      expect(output).toMatch(/computer_run is off[\s\S]*single tools/);
      expect(output).toContain('[1] text area value="hello" focused');
      expect(methods()).not.toContain('act');
    } finally { vi.unstubAllEnvs(); }
  });

  it('switched off in the vault answers like no key, even with one stored', async () => {
    const keys: string[] = [];
    const { tools } = backend([], {}, jev(keys));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    const output = forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Add a word', steps }, 'turn', { TYPESAFE_API_KEY: 'vault-key', JEV_DISABLED: '1' }));
    expect(output).toMatch(/computer_run is off[\s\S]*single tools/);
    expect(keys).toEqual([]);
    expect(methods()).not.toContain('act');
  });

  describe('offered only with a key', () => {
    const tool = (name: string) => ({ name, description: '', inputSchema: {} }) as never;
    const offered = async (instance: ComputerBackend) => {
      const request = { model: 'm', messages: [], tools: [tool('computer_run'), tool('computer_click'), tool('Read')] };
      const hook = instance.hooks.onBeforeProviderCall as NonNullable<typeof instance.hooks.onBeforeProviderCall>;
      const guided = (await hook(request, { sessionId: 'session', turnId: 'turn' } as never)) ?? request;
      return { names: (guided.tools ?? []).map((entry) => entry.name), system: guided.system ?? '' };
    };

    it('hides computer_run and every word about it while there is no key', async () => {
      vi.stubEnv('TYPESAFE_API_KEY', '');
      try {
        const { instance, tools } = backend([], {}, jev([]));
        await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
        const { names, system } = await offered(instance);
        expect(names).toEqual(['computer_click', 'Read']);
        expect(system).not.toMatch(/computer_run/);
        expect(system).toMatch(/several tool calls in one response/);
      } finally { vi.unstubAllEnvs(); }
    });

    it('offers it once a tool call has seen the key in the vault', async () => {
      vi.stubEnv('TYPESAFE_API_KEY', '');
      try {
        const { instance, tools } = backend([], {}, jev([]));
        await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
        await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'turn', { TYPESAFE_API_KEY: 'vault-key' });
        const { names, system } = await offered(instance);
        expect(names).toContain('computer_run');
        expect(system).toMatch(/computer_run/);
      } finally { vi.unstubAllEnvs(); }
    });

    it('hides it once a tool call has seen it switched off in the vault', async () => {
      vi.stubEnv('TYPESAFE_API_KEY', 'env-key');
      try {
        const { instance, tools } = backend([], {}, jev([]));
        await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
        await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'turn', { JEV_DISABLED: '1' });
        const { names, system } = await offered(instance);
        expect(names).toEqual(['computer_click', 'Read']);
        expect(system).not.toMatch(/computer_run/);
      } finally { vi.unstubAllEnvs(); }
    });

    it('offers it from the first request when the key is in the environment', async () => {
      vi.stubEnv('TYPESAFE_API_KEY', 'env-key');
      try {
        const { names } = await offered(backend([], {}, jev([])).instance);
        expect(names).toContain('computer_run');
      } finally { vi.unstubAllEnvs(); }
    });
  });

  describe('learning', () => {
    const secrets = { TYPESAFE_API_KEY: 'k' };
    /** Like `jev`, and records which questions each request asked. */
    const recording = (asked: string[][]) => (): AskJev => async (state, questions) => {
      asked.push(Object.keys(questions));
      return jev([])('k')(state, questions, new AbortController().signal);
    };

    it('remembers the element of a verified step: the same step later asks Jev only to check it', async () => {
      const asked: string[][] = [];
      const { tools } = backend([], {}, recording(asked));
      await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
      await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Add a word', steps }, 'turn', secrets);
      expect(asked.flat()).toContain('target');
      asked.length = 0;
      const again = backend([], {}, recording(asked));
      const output = forModel(await run(again.tools, 'computer_run', { app: 'TextEdit', goal: 'Add a word', steps }, 'later', secrets));
      expect(output).toMatch(/2 of 2 steps done[\s\S]*1\. verified/);
      expect(output).toMatch(/remembered/);
      expect(asked.flat()).not.toContain('target');
    });

    it('shows the routes that reached their end with the app\'s first state of a turn', async () => {
      const { tools } = backend([], {}, jev([]));
      await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
      await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Add a word', steps }, 'turn', secrets);
      const first = forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'later', secrets));
      expect(first).toMatch(/Routes that worked in this app before[\s\S]*Add a word[\s\S]*"target":"text area"/);
      expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'later', secrets))).not.toMatch(/Routes that worked/);
      vi.stubEnv('TYPESAFE_API_KEY', '');
      try {
        expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }, 'no-key'))).not.toMatch(/Routes that worked/);
      } finally { vi.unstubAllEnvs(); }
    });

    it('learns from the model: the element it used after a step failed is the step\'s element next time', async () => {
      const asked: string[][] = [];
      const { tools } = backend([], {}, recording(asked));
      await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
      const note = [{ do: 'type', target: 'the notes box', text: ' x', expect: 'the text ends with x' }];
      expect(forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Note', steps: note }, 'turn', secrets))).toMatch(/1\. FAILED/);
      await run(tools, 'computer_type_text', { app: 'TextEdit', element_index: 1, text: ' x' }, 'turn', secrets);
      asked.length = 0;
      const output = forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Note', steps: note }, 'later', secrets));
      expect(output).toMatch(/1\. verified/);
      expect(asked.flat()).not.toContain('target');
    });

    // In Canva a click on a link only lit it up, and that link was then remembered as "the create button".
    it('does not learn an element whose click changed only the picture, such as a hover highlight', async () => {
      const asked: string[][] = [];
      const { tools } = backend([], {}, recording(asked));
      await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
      await run(tools, 'computer_type_text', { app: 'TextEdit', element_index: 1, text: '<hover>' }, 'turn', secrets);
      const create = [{ do: 'click', target: 'the create button', expect: 'a new design opens' }];
      expect(forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Create', steps: create }, 'turn', secrets))).toMatch(/1\. FAILED/);
      expect(forModel(await run(tools, 'computer_click', { app: 'TextEdit', element_index: 2 }, 'turn', secrets))).toMatch(/No changes since the previous state/);
      asked.length = 0;
      await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Create', steps: create }, 'later', secrets);
      expect(asked.flat()).toContain('target');
    });
  });

  it('looks at the window without a picture for the run, and hands the model one at the end', async () => {
    const { tools } = backend([], {}, jev([]));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    const output = await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Note', steps: [{ do: 'type', target: 'the missing box', text: 'x' }] }, 'turn', { TYPESAFE_API_KEY: 'k' }) as ToolImageResult;
    expect(output.forModel).toMatch(/1\. FAILED/);
    expect(output.base64).toEqual(expect.any(String));
    const looks = helperRequests(requestsFile).filter((request) => request.method === 'get_app_state').map((request) => (request.params as { screenshot: boolean }).screenshot);
    expect(looks).toEqual([false, false, true]);
  });

  it('sends steps that check nothing and need no element as one batch on macOS', async () => {
    const { tools } = backend([], {}, jev([]));
    await requestAccess(tools, { apps: ['TextEdit'], reason: 'Edit' });
    const output = forModel(await run(tools, 'computer_run', { app: 'TextEdit', goal: 'Note', steps: [{ do: 'type', text: ' a' }, { do: 'key', key: 'Return' }] }, 'turn', { TYPESAFE_API_KEY: 'k' }));
    expect(output).toMatch(/2 of 2 steps done/);
    expect(methods()).toContain('batch');
    expect(methods()).not.toContain('act');
  });

  it('stops at a step the grant does not allow and leaves the rest', async () => {
    const { tools } = backend([], {}, jev([]));
    await requestAccess(tools, { apps: ['Safari'], reason: 'Read' });
    const output = forModel(await run(tools, 'computer_run', { app: 'Safari', goal: 'Save', steps: [{ do: 'click', target: 'Save' }, { do: 'key', key: 'Return' }] }, 'turn', { TYPESAFE_API_KEY: 'k' }));
    expect(output).toMatch(/0 of 2 steps[\s\S]*1\. FAILED[\s\S]*tier_insufficient[\s\S]*Not run: step 2/);
    expect(methods()).not.toContain('act');
  });

  describe('on an app not granted yet', () => {
    /** Record a run the way dispatch does before the handler: requested, then approved. */
    const approveRun = (input: Record<string, unknown>, approval: Record<string, unknown>) => {
      const callId = `call-${seq}`;
      events.push({ ...base('turn'), type: 'tool_call_requested', callId, name: 'computer_run', input } as MoxxyEvent);
      events.push({ ...base('turn'), type: 'tool_call_approved', callId, decidedBy: 'resolver', mode: 'allow', ...approval } as MoxxyEvent);
    };
    const secrets = { TYPESAFE_API_KEY: 'k' };

    it('runs when the user approved that very call, and the app stays granted for the conversation', async () => {
      const { tools } = backend([], {}, jev([]));
      const input = { app: 'TextEdit', goal: 'Add a word', steps };
      approveRun(input, { decidedNow: true });
      expect(forModel(await run(tools, 'computer_run', input, 'turn', secrets))).toMatch(/computer_run: 2 of 2 steps done/);
      expect(forModel(await run(tools, 'computer_get_app_state', { app: 'TextEdit' }))).toContain('App: TextEdit');
    });

    it('is refused when a standing rule let the call through: nobody was asked about this app', async () => {
      const { tools } = backend([], {}, jev([]));
      const input = { app: 'TextEdit', goal: 'Add a word', steps };
      approveRun(input, {});
      await expect(run(tools, 'computer_run', input, 'turn', secrets)).rejects.toMatchObject({ code: 'app_not_allowed' });
      expect(methods()).not.toContain('act');
    });

    it('gives a browser reached this way its read-only default', async () => {
      const { tools } = backend([], {}, jev([]));
      const input = { app: 'Safari', goal: 'Save', steps: [{ do: 'click', target: 'Save' }] };
      approveRun(input, { decidedNow: true });
      expect(forModel(await run(tools, 'computer_run', input, 'turn', secrets))).toMatch(/0 of 1 steps[\s\S]*tier_insufficient/);
      expect(methods()).not.toContain('act');
    });

    it('keeps the level the user chose in the access dialog over the default of a later run', async () => {
      const { tools } = backend([], {}, jev([]));
      await requestAccess(tools, { apps: ['Safari'], reason: 'Fill a form', full_access: ['Safari'] });
      const input = { app: 'Safari', goal: 'Save', steps: [{ do: 'click', target: 'Save' }] };
      approveRun(input, { decidedNow: true });
      expect(forModel(await run(tools, 'computer_run', input, 'turn', secrets))).not.toMatch(/tier_insufficient/);
    });

    describe('while the conversation auto-approves', () => {
      const autoApprove = (enabled: boolean) => {
        events.push({ ...base('turn'), type: 'plugin_event', pluginId: AUTO_APPROVE_PLUGIN_ID, subtype: AUTO_APPROVE_SUBTYPE, payload: { enabled } } as MoxxyEvent);
      };
      const input = { app: 'Safari', goal: 'Search', steps: [{ do: 'key', key: 'Return' }] };

      // Auto-approve skips the prompt, never the policy: full control still comes from a request the policy sees.
      it('keeps a browser it reached through a run at its default level', async () => {
        const { tools } = backend([], {}, jev([]));
        autoApprove(true);
        approveRun(input, { decidedNow: true });
        expect(forModel(await run(tools, 'computer_run', input, 'turn', secrets))).toMatch(/tier_insufficient/);
        expect(methods()).not.toContain('act');
      });

      it('lets a run press keys once full control was requested', async () => {
        const { tools } = backend([], {}, jev([]));
        autoApprove(true);
        await requestAccess(tools, { apps: ['Safari'], reason: 'Search', full_access: ['Safari'] });
        expect(forModel(await run(tools, 'computer_run', input, 'turn', secrets))).not.toMatch(/tier_insufficient/);
        expect(methods()).toContain('act');
      });
    });

    it('says which app it could not find', async () => {
      const { tools } = backend([], {}, jev([]));
      const input = { app: 'Mail', goal: 'Read', steps: [{ do: 'click', target: 'Inbox' }] };
      approveRun(input, { decidedNow: true });
      await expect(run(tools, 'computer_run', input, 'turn', secrets)).rejects.toMatchObject({ code: 'app_not_allowed' });
    });
  });

  it('may reach TypeSafe and nothing else on the network', () => {
    const { tools } = backend();
    expect(tools.get('computer_run')?.isolation?.capabilities.net).toEqual({ mode: 'allowlist', hosts: ['api.typesafe.ai'] });
    expect(tools.get('computer_click')?.isolation?.capabilities.net).toEqual({ mode: 'none' });
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
