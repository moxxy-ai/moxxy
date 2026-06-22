import { describe, expect, it, vi } from 'vitest';
import { runSlash, type SlashDeps } from './run-slash.js';

// run-slash.ts imports savePreferences/clearUsageStats from @moxxy/core; stub
// them so /goal's preference save doesn't touch ~/.moxxy during the unit test.
vi.mock('@moxxy/core', () => ({
  savePreferences: vi.fn(async () => undefined),
  clearUsageStats: vi.fn(async () => undefined),
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

  it('switches to goal mode, forces yolo on, and starts work with the objective', () => {
    const { deps, calls } = goalDeps();
    runSlash('/goal build the widget and make the tests pass', deps);
    expect(calls.setActive).toEqual(['goal']);
    expect(calls.yolo).toEqual([true]);
    expect(calls.submitted).toEqual(['build the widget and make the tests pass']);
  });

  it('bare /goal arms the mode without submitting a turn', () => {
    const { deps, calls } = goalDeps();
    runSlash('/goal', deps);
    expect(calls.setActive).toEqual(['goal']);
    expect(calls.yolo).toEqual([true]);
    expect(calls.submitted).toEqual([]);
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
