import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePickerHandler, type PickerHandlerDeps } from './picker-handlers.js';
import { NEW_SESSION_OPTION_ID } from './sessions-picker.js';
import { openPluginsPicker } from './run-slash.js';

// picker-handlers imports setCategoryDefault/setProviderModel from @moxxy/config
// and re-open helpers from run-slash; stub both so the session branch tests stay
// isolated from the filesystem and the other picker flows.
vi.mock('@moxxy/config', () => ({
  setCategoryDefault: vi.fn(async () => undefined),
  setProviderModel: vi.fn(async () => undefined),
}));
vi.mock('./run-slash.js', () => ({
  openMcpPicker: vi.fn(),
  openPluginsPicker: vi.fn(),
}));

function baseDeps(over: Partial<PickerHandlerDeps> = {}): PickerHandlerDeps {
  return {
    session: { id: 'sess-current' },
    providerName: 'openai',
    setPicker: vi.fn(),
    setSystemNotice: vi.fn(),
    setActiveModelOverride: vi.fn(),
    refreshMcpStatus: vi.fn(async () => undefined),
    ...over,
  } as unknown as PickerHandlerDeps;
}

const sessionsPicker = { kind: 'sessions', title: 'Switch session', options: [] } as const;

describe('makePickerHandler — sessions branch', () => {
  it('requests a resume switch for a persisted session id', () => {
    const requestSessionSwitch = vi.fn(async () => undefined);
    const setPicker = vi.fn();
    const handle = makePickerHandler(baseDeps({ requestSessionSwitch, setPicker }));
    handle(sessionsPicker, 'sess-other');
    expect(setPicker).toHaveBeenCalledWith(null); // picker dismissed
    expect(requestSessionSwitch).toHaveBeenCalledWith({ kind: 'resume', id: 'sess-other' });
  });

  it('requests a fresh session for the new-session entry', () => {
    const requestSessionSwitch = vi.fn(async () => undefined);
    const handle = makePickerHandler(baseDeps({ requestSessionSwitch }));
    handle(sessionsPicker, NEW_SESSION_OPTION_ID);
    expect(requestSessionSwitch).toHaveBeenCalledWith({ kind: 'new' });
  });

  it('no-ops (with a notice) when picking the session you are already in', () => {
    const requestSessionSwitch = vi.fn(async () => undefined);
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(baseDeps({ requestSessionSwitch, setSystemNotice }));
    handle(sessionsPicker, 'sess-current');
    expect(requestSessionSwitch).not.toHaveBeenCalled();
    expect(setSystemNotice).toHaveBeenCalledWith("you're already in that session");
  });

  it('surfaces a switch failure on the still-live session', async () => {
    const requestSessionSwitch = vi.fn(async () => {
      throw new Error('boom');
    });
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(baseDeps({ requestSessionSwitch, setSystemNotice }));
    handle(sessionsPicker, 'sess-other');
    await new Promise((r) => setImmediate(r));
    expect(setSystemNotice).toHaveBeenCalledWith('failed to switch session: boom');
  });

  it('reports gracefully when no switch capability is wired', () => {
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(baseDeps({ setSystemNotice }));
    handle(sessionsPicker, 'sess-other');
    expect(setSystemNotice).toHaveBeenCalledWith(
      'switching sessions is not available on this session',
    );
  });
});

const modelPicker = { kind: 'model', title: 'Model', tabs: [] } as const;

describe('makePickerHandler — model branch, unconnected provider', () => {
  it('opens the inline connect dialog when the session can connect', () => {
    const openProviderConnect = vi.fn();
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: {
          id: 's',
          readyProviders: new Set(['openai']),
          providerSetup: {},
        } as never,
        openProviderConnect,
        setSystemNotice,
      }),
    );
    handle(modelPicker, 'anthropic::claude-opus-4-8');
    expect(openProviderConnect).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
    });
    expect(setSystemNotice).not.toHaveBeenCalled();
  });

  it('falls back to the init/login notice without providerSetup', () => {
    const openProviderConnect = vi.fn();
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', readyProviders: new Set() } as never,
        openProviderConnect,
        setSystemNotice,
      }),
    );
    handle(modelPicker, 'anthropic::claude-opus-4-8');
    expect(openProviderConnect).not.toHaveBeenCalled();
    expect(setSystemNotice).toHaveBeenCalledWith(
      expect.stringContaining("anthropic isn't connected"),
    );
  });
});

const pluginsPicker = { kind: 'plugins', title: 'Plugins', options: [] } as const;

describe('makePickerHandler — installable-tab install', () => {
  beforeEach(() => {
    vi.mocked(openPluginsPicker).mockClear();
  });

  it('falls back to the printed command when the session cannot install', () => {
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({ session: { id: 's', pluginsAdmin: {} } as never, setSystemNotice }),
    );
    handle(pluginsPicker, 'telegram::install');
    expect(setSystemNotice).toHaveBeenCalledWith(
      'to install: run `moxxy plugins install telegram`',
    );
    expect(openPluginsPicker).not.toHaveBeenCalled();
  });

  it('installs via the admin view, reports registrations, and reopens the picker', async () => {
    const install = vi.fn(async () => ({
      installed: '@moxxy/mode-goal@1.0.0',
      registered: { modes: ['goal'], tools: [] },
    }));
    const setSystemNotice = vi.fn();
    const installInFlightRef = { current: false };
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setSystemNotice,
        installInFlightRef,
      }),
    );
    handle(pluginsPicker, 'mode-goal::install');
    expect(setSystemNotice).toHaveBeenCalledWith(
      'installing mode-goal via npm — this can take a minute…',
    );
    expect(installInFlightRef.current).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(install).toHaveBeenCalledWith('mode-goal');
    expect(setSystemNotice).toHaveBeenLastCalledWith(
      '✓ installed @moxxy/mode-goal@1.0.0 — registered modes: goal',
    );
    expect(installInFlightRef.current).toBe(false);
    expect(openPluginsPicker).toHaveBeenCalledTimes(1);
  });

  it('surfaces an install failure and still reopens the picker', async () => {
    const install = vi.fn(async () => {
      throw new Error('npm install failed (exit 1): 404');
    });
    const setSystemNotice = vi.fn();
    const installInFlightRef = { current: false };
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setSystemNotice,
        installInFlightRef,
      }),
    );
    handle(pluginsPicker, 'x::install');
    await new Promise((r) => setImmediate(r));
    expect(setSystemNotice).toHaveBeenLastCalledWith(
      'install failed: npm install failed (exit 1): 404',
    );
    expect(installInFlightRef.current).toBe(false);
    expect(openPluginsPicker).toHaveBeenCalledTimes(1);
  });

  it('refuses a second install while one is in flight', () => {
    const install = vi.fn(async () => ({ installed: 'x', registered: {} }));
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setSystemNotice,
        installInFlightRef: { current: true },
      }),
    );
    handle(pluginsPicker, 'y::install');
    expect(install).not.toHaveBeenCalled();
    expect(setSystemNotice).toHaveBeenCalledWith('an install is already running — hang on…');
  });
});
