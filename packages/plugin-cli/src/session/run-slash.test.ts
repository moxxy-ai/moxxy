import { describe, expect, it, vi } from 'vitest';
import {
  isProductExtensionPackage,
  runSlash,
  type SlashDeps,
} from './run-slash.js';

// run-slash.ts imports clearUsageStats/readSessionIndex from @moxxy/core and
// setCategoryDefault from @moxxy/config; stub them so /goal's mode-default
// persist and /sessions' index read don't touch ~/.moxxy during the unit test.
const sessionIndex = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@moxxy/core', () => ({
  clearUsageStats: vi.fn(async () => undefined),
  readSessionIndex: vi.fn(async () => sessionIndex.value),
}));
vi.mock('@moxxy/config', () => ({
  setCategoryDefault: vi.fn(async () => undefined),
}));

describe('runSlash', () => {
  it('shows a pending notice before awaiting a long-running registered command', async () => {
    const notices: Array<string | null> = [];
    let finish: ((value: { kind: 'text'; text: string }) => void) | null = null;
    const commandDone = new Promise<{ kind: 'text'; text: string }>((resolve) => {
      finish = resolve;
    });

    runSlash('/compact', {
      ...baseDeps(),
      setSystemNotice: (notice) => notices.push(notice),
      session: {
        id: 'sess-1',
        commands: {
          get: () => ({
            name: 'compact',
            description: 'Manually compact context',
            pendingNotice: 'compacting context...',
            handler: () => commandDone,
          }),
        },
      },
    } as unknown as SlashDeps);

    expect(notices).toEqual(['compacting context...']);
    finish?.({ kind: 'text', text: 'context compacted: 3 events, ~1.2k tokens saved' });
    await commandDone;
    await Promise.resolve();

    expect(notices).toEqual([
      'compacting context...',
      'context compacted: 3 events, ~1.2k tokens saved',
    ]);
  });
});

describe('runSlash /goal', () => {
  function goalDeps() {
    const calls = {
      setActive: [] as string[],
      yolo: [] as boolean[],
      submitted: [] as string[],
      notices: [] as Array<string | null>,
    };
    const deps = {
      ...baseDeps(),
      session: {
        id: 'sess-1',
        commands: { get: () => undefined },
        modes: {
          list: () => [{ name: 'goal' }, { name: 'default' }],
          setActive: (n: string) => calls.setActive.push(n),
        },
      },
      setYolo: (u: boolean | ((p: boolean) => boolean)) =>
        calls.yolo.push(typeof u === 'function' ? u(false) : u),
      submitPrompt: (t: string) => calls.submitted.push(t),
      setSystemNotice: (n: string | null) => calls.notices.push(n),
    } as unknown as SlashDeps;
    return { deps, calls };
  }

  it('switches to goal mode and starts work with the objective — no yolo flip', () => {
    const { deps, calls } = goalDeps();
    runSlash('/goal build the widget and make the tests pass', deps);
    expect(calls.setActive).toEqual(['goal']);
    // Goal mode auto-approves its own tool calls via a run-scoped resolver; a
    // session-wide yolo flip would outlive the run (permission leak).
    expect(calls.yolo).toEqual([]);
    expect(calls.submitted).toEqual(['build the widget and make the tests pass']);
  });

  it('bare /goal arms the mode without submitting a turn', () => {
    const { deps, calls } = goalDeps();
    runSlash('/goal', deps);
    expect(calls.setActive).toEqual(['goal']);
    expect(calls.yolo).toEqual([]);
    expect(calls.submitted).toEqual([]);
  });

  it('never persists goal as the category default (transient mode)', async () => {
    const { setCategoryDefault } = await import('@moxxy/config');
    vi.mocked(setCategoryDefault).mockClear();
    const { deps } = goalDeps();
    runSlash('/goal build the widget', deps);
    // `/goal` once must not make every future session boot autonomous.
    expect(setCategoryDefault).not.toHaveBeenCalled();
  });

  it('reports when goal mode is not registered', () => {
    const { deps, calls } = goalDeps();
    (deps.session as unknown as { modes: { list: () => unknown[] } }).modes.list = () => [
      { name: 'default' },
    ];
    runSlash('/goal do a thing', deps);
    expect(calls.setActive).toEqual([]);
    expect(calls.submitted).toEqual([]);
    expect(calls.notices.some((n) => typeof n === 'string' && /not available/.test(n))).toBe(true);
  });
});

describe('runSlash /collab', () => {
  function collabDeps() {
    const calls = {
      switched: [] as Array<string | undefined>,
      commands: [] as Array<{ name: string; args: string }>,
      notices: [] as Array<string | null>,
    };
    const controlNames = new Set([
      'collab_say',
      'collab_direct',
      'collab_pause',
      'collab_resume',
    ]);
    const deps = {
      ...baseDeps(),
      session: {
        id: 'sess-1',
        commands: {
          get: (name: string) =>
            controlNames.has(name)
              ? {
                  name,
                  description: 'collaboration control',
                  handler: ({ args }: { args: string }) => {
                    calls.commands.push({ name, args });
                    return { kind: 'text' as const, text: `${name} complete` };
                  },
                }
              : undefined,
        },
        modes: {
          list: () => [{ name: 'default' }, { name: 'collaborative' }],
        },
      },
      requestCollab: (goal?: string) => calls.switched.push(goal),
      setSystemNotice: (notice: string | null) => calls.notices.push(notice),
    } as unknown as SlashDeps;
    return { deps, calls };
  }

  it('opens the team view when bare and starts a goal without exposing a second command', () => {
    const { deps, calls } = collabDeps();
    runSlash('/collab', deps);
    runSlash('/collab improve the release flow', deps);
    runSlash('/collab start audit the API', deps);

    expect(calls.switched).toEqual([undefined, 'improve the release flow', 'audit the API']);
  });

  it('routes team controls through the single /collab namespace', async () => {
    const { deps, calls } = collabDeps();
    runSlash('/collab say all check the failing test', deps);
    runSlash('/collab direct prioritize correctness', deps);
    runSlash('/collab pause', deps);
    runSlash('/collab resume', deps);
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls.switched).toEqual([]);
    expect(calls.commands).toEqual([
      { name: 'collab_say', args: 'all check the failing test' },
      { name: 'collab_direct', args: 'prioritize correctness' },
      { name: 'collab_pause', args: '' },
      { name: 'collab_resume', args: '' },
    ]);
    expect(calls.notices).toContain('Team paused. Use /collab resume to continue.');
  });

  it('shows a compact entry guide without switching sessions', () => {
    const { deps, calls } = collabDeps();
    runSlash('/collab help', deps);

    expect(calls.switched).toEqual([]);
    expect(calls.notices[0]).toContain('/collab <goal>');
    expect(calls.notices[0]).toContain('/collab pause | resume');
    expect(calls.notices[0]).not.toContain('/collab_pause');
  });
});

describe('runSlash /mode — transient modes are never persisted as the default', () => {
  function modeDeps() {
    const calls = { setActive: [] as string[] };
    const deps = {
      ...baseDeps(),
      session: {
        id: 'sess-1',
        commands: { get: () => undefined },
        modes: {
          list: () => [{ name: 'goal', transient: true }, { name: 'default' }],
          setActive: (n: string) => calls.setActive.push(n),
        },
      },
      setSystemNotice: () => undefined,
    } as unknown as SlashDeps;
    return { deps, calls };
  }

  it('/mode goal switches but does not persist (transient)', async () => {
    const { setCategoryDefault } = await import('@moxxy/config');
    vi.mocked(setCategoryDefault).mockClear();
    const { deps, calls } = modeDeps();
    runSlash('/mode goal', deps);
    expect(calls.setActive).toEqual(['goal']);
    expect(setCategoryDefault).not.toHaveBeenCalled();
  });

  it('/mode default switches AND persists (non-transient)', async () => {
    const { setCategoryDefault } = await import('@moxxy/config');
    vi.mocked(setCategoryDefault).mockClear();
    const { deps, calls } = modeDeps();
    runSlash('/mode default', deps);
    expect(calls.setActive).toEqual(['default']);
    expect(setCategoryDefault).toHaveBeenCalledWith('mode', 'default');
  });
});

describe('runSlash dispatch safety', () => {
  it('does not throw and reports unknown for an empty / whitespace command', () => {
    const notices: Array<string | null> = [];
    expect(() =>
      runSlash('', { ...baseDeps(), setSystemNotice: (n) => notices.push(n) }),
    ).not.toThrow();
    expect(() =>
      runSlash('   ', { ...baseDeps(), setSystemNotice: (n) => notices.push(n) }),
    ).not.toThrow();
    expect(() =>
      runSlash('/', { ...baseDeps(), setSystemNotice: (n) => notices.push(n) }),
    ).not.toThrow();
    expect(notices.every((n) => typeof n === 'string' && /unknown command/.test(n))).toBe(true);
  });

  it('matches channel-local commands case-insensitively (/Tools === /tools)', () => {
    const overlays: unknown[] = [];
    runSlash('/Tools', {
      ...baseDeps(),
      setOverlay: (o) => overlays.push(typeof o === 'function' ? o(null) : o),
    } as unknown as SlashDeps);
    expect(overlays).toContainEqual({ kind: 'tools' });
  });
});

describe('runSlash /runs', () => {
  it('degrades to a notice when the host cannot switch runs', () => {
    const notices: Array<string | null> = [];
    const pickers: unknown[] = [];
    runSlash('/runs', {
      ...baseDeps(),
      canSwitchSession: false,
      setSystemNotice: (n) => notices.push(n),
      setPicker: (p) => pickers.push(p),
    } as unknown as SlashDeps);
    // No async index read / picker open on the degrade path.
    expect(pickers).toEqual([]);
    expect(notices.some((n) => typeof n === 'string' && /unavailable/.test(n))).toBe(true);
  });

  it('opens a Runs picker with a new-run entry when switching is available', async () => {
    sessionIndex.value = [
      {
        id: 'sess-current',
        cwd: '/x',
        startedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        eventCount: 4,
        firstPrompt: 'fix the bug',
        provider: 'openai',
        model: 'gpt-test',
      },
      {
        id: 'sess-other',
        cwd: '/y',
        startedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        eventCount: 2,
        firstPrompt: 'write docs',
        provider: 'openai',
        model: 'gpt-test',
      },
    ];
    const pickers: unknown[] = [];
    runSlash('/runs', {
      ...baseDeps(),
      session: { id: 'sess-current', commands: { get: () => undefined } },
      canSwitchSession: true,
      setPicker: (p) => pickers.push(p),
    } as unknown as SlashDeps);
    // openSessionsPicker reads the index asynchronously, then sets the picker.
    await new Promise((r) => setImmediate(r));
    expect(pickers).toHaveLength(1);
    const picker = pickers[0] as {
      kind: string;
      title: string;
      options: Array<{ id: string; current?: boolean }>;
    };
    expect(picker.kind).toBe('sessions');
    expect(picker.title).toBe('Runs');
    // "+ New run" first, then the two persisted ones; current marked.
    expect(picker.options[0]!.id).toBe('__new__');
    expect(picker.options.find((o) => o.id === 'sess-current')!.current).toBe(true);
    expect(picker.options.map((o) => o.id)).toContain('sess-other');
  });
});

describe('runSlash command help', () => {
  it('shows the complete available command catalog', () => {
    const notices: Array<string | null> = [];
    runSlash('/help', {
      ...baseDeps(),
      session: {
        id: 'sess-1',
        commands: { get: () => undefined, listForChannel: () => [] },
        pluginsAdmin: {},
      },
      canSwitchSession: true,
      setSystemNotice: (notice) => notices.push(notice),
    } as unknown as SlashDeps);

    expect(notices[0]).toContain('/runs');
    expect(notices[0]).toContain('/extensions');
    expect(notices[0]).toMatch(/^\/mode\s/m);
  });

  it('does not advertise controls an attached fixed runner cannot execute', () => {
    const notices: Array<string | null> = [];
    runSlash('/help', {
      ...baseDeps(),
      session: {
        id: 'sess-1',
        commands: { get: () => undefined, listForChannel: () => [] },
      },
      canSwitchSession: false,
      setSystemNotice: (notice) => notices.push(notice),
    } as unknown as SlashDeps);

    expect(notices[0]).not.toMatch(/^\/runs\s/m);
    expect(notices[0]).not.toMatch(/^\/extensions\s/m);
    expect(notices[0]).not.toMatch(/^\/new\s/m);
    expect(notices[0]).toContain('Type / and keep typing to filter.');
  });

  it('does not clear an attached runner when /new cannot create a separate run', () => {
    const notices: Array<string | null> = [];
    let handlerCalled = false;
    runSlash('/new', {
      ...baseDeps(),
      session: {
        id: 'sess-1',
        commands: {
          get: () => ({
            name: 'new',
            description: 'Start a fresh run',
            handler: () => {
              handlerCalled = true;
              return { kind: 'session-action', action: 'new' };
            },
          }),
        },
      },
      canSwitchSession: false,
      setSystemNotice: (notice) => notices.push(notice),
    } as unknown as SlashDeps);

    expect(handlerCalled).toBe(false);
    expect(notices[0]).toContain('separate run');
  });
});

describe('runSlash /speak', () => {
  it('forwards the argument to runSpeak and clears the notice', () => {
    const args: string[] = [];
    const notices: Array<string | null> = [];
    runSlash('/speak on', {
      ...baseDeps(),
      runSpeak: (a) => args.push(a),
      setSystemNotice: (n) => notices.push(n),
    } as unknown as SlashDeps);
    expect(args).toEqual(['on']);
    expect(notices).toContain(null);
  });

  it('bare /speak forwards an empty argument', () => {
    const args: string[] = [];
    runSlash('/speak', { ...baseDeps(), runSpeak: (a) => args.push(a) } as unknown as SlashDeps);
    expect(args).toEqual(['']);
  });

  it('the /say alias forwards too', () => {
    const args: string[] = [];
    runSlash('/say stop', { ...baseDeps(), runSpeak: (a) => args.push(a) } as unknown as SlashDeps);
    expect(args).toEqual(['stop']);
  });

  it('degrades to a notice when read-aloud is not wired', () => {
    const notices: Array<string | null> = [];
    runSlash('/speak on', {
      ...baseDeps(),
      runSpeak: undefined,
      setSystemNotice: (n) => notices.push(n),
    } as unknown as SlashDeps);
    expect(notices.some((n) => typeof n === 'string' && /not available/.test(n))).toBe(true);
  });
});

describe('extension product surface', () => {
  it('keeps model connection packages in /model instead of /extensions', () => {
    expect(isProductExtensionPackage('@moxxy/plugin-provider-openai')).toBe(false);
    expect(
      isProductExtensionPackage('@vendor/models', [{ category: 'provider' }]),
    ).toBe(false);
    expect(isProductExtensionPackage('@moxxy/plugin-browser')).toBe(true);
    expect(isProductExtensionPackage('@moxxy/mode-goal')).toBe(true);
  });
});

function baseDeps(): SlashDeps {
  return {
    session: {
      id: 'sess-1',
      commands: { get: () => undefined },
    },
    providerName: 'openai',
    activeModel: 'gpt-test',
    modeName: 'default',
    setSystemNotice: () => undefined,
    setOverlay: () => undefined,
    setYolo: () => undefined,
    setPicker: () => undefined,
    queueRef: { current: [] },
    setQueueCount: () => undefined,
    performSessionAction: () => undefined,
    submitPrompt: () => undefined,
  } as unknown as SlashDeps;
}
