import { describe, expect, it, vi } from 'vitest';
import { runSlash, type SlashDeps } from './run-slash.js';

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

describe('runSlash /sessions', () => {
  it('degrades to a notice when the host cannot switch sessions', () => {
    const notices: Array<string | null> = [];
    const pickers: unknown[] = [];
    runSlash('/sessions', {
      ...baseDeps(),
      canSwitchSession: false,
      setSystemNotice: (n) => notices.push(n),
      setPicker: (p) => pickers.push(p),
    } as unknown as SlashDeps);
    // No async index read / picker open on the degrade path.
    expect(pickers).toEqual([]);
    expect(notices.some((n) => typeof n === 'string' && /only available/.test(n))).toBe(true);
  });

  it('opens a sessions picker (with a new-session entry) when switching is available', async () => {
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
    runSlash('/sessions', {
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
      options: Array<{ id: string; current?: boolean }>;
    };
    expect(picker.kind).toBe('sessions');
    // "+ New session" first, then the two persisted ones; current marked.
    expect(picker.options[0]!.id).toBe('__new__');
    expect(picker.options.find((o) => o.id === 'sess-current')!.current).toBe(true);
    expect(picker.options.map((o) => o.id)).toContain('sess-other');
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
