import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePickerHandler, type PickerHandlerDeps } from './picker-handlers.js';
import { NEW_SESSION_OPTION_ID } from './sessions-picker.js';
import { openPluginsPicker } from './run-slash.js';

// picker-handlers imports setCategoryDefault/setProviderModel from @moxxy/config
// and re-open helpers from run-slash; stub both so the session branch tests stay
// isolated from the filesystem and the other picker flows. Partial mock: the
// @moxxy/plugin-plugins-admin import (capability consent copy) pulls other
// @moxxy/config exports, which must keep resolving to the real module.
vi.mock('@moxxy/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moxxy/config')>()),
  setCategoryDefault: vi.fn(async () => undefined),
  setProviderModel: vi.fn(async () => undefined),
  setConfigValue: vi.fn(async () => ({ path: '/tmp/config.yaml', config: {} })),
  loadConfig: vi.fn(async () => ({ config: {}, sources: [] })),
}));
vi.mock('./run-slash.js', () => ({
  openMcpPicker: vi.fn(),
  openPluginsPicker: vi.fn(),
  openModelPicker: vi.fn(),
  openModePicker: vi.fn(),
  openSettingsPicker: vi.fn(),
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

describe('makePickerHandler — install-on-first-use', () => {
  it('install-confirm: installs then re-runs the original slash line', async () => {
    const install = vi.fn(async () => ({ installed: '@moxxy/mode-goal@1.0.0', registered: {} }));
    const rerunSlash = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setSystemNotice: vi.fn(),
        rerunSlash,
        installInFlightRef: { current: false },
      }),
    );
    handle(
      {
        kind: 'install-confirm',
        title: 'goal is not installed',
        catalogId: 'mode-goal',
        rerun: '/goal ship it',
        options: [],
      },
      'install',
    );
    await new Promise((r) => setImmediate(r));
    expect(install).toHaveBeenCalledWith('mode-goal');
    expect(rerunSlash).toHaveBeenCalledWith('/goal ship it');
  });

  it('install-confirm: cancel does nothing', async () => {
    const install = vi.fn();
    const rerunSlash = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        rerunSlash,
      }),
    );
    handle(
      { kind: 'install-confirm', title: 't', catalogId: 'x', rerun: '/mode x', options: [] },
      'cancel',
    );
    await new Promise((r) => setImmediate(r));
    expect(install).not.toHaveBeenCalled();
    expect(rerunSlash).not.toHaveBeenCalled();
  });

  it('mode picker install:: id installs the providing package then re-runs /mode', async () => {
    // First-party spec: catalog installs resolve to the pinned @moxxy package.
    const install = vi.fn(async () => ({ installed: '@moxxy/mode-goal@1.0.0', registered: {} }));
    const catalog = vi.fn(() => [
      {
        id: 'mode-goal',
        label: 'Goal mode',
        packageName: '@moxxy/mode-goal',
        installSpec: '@moxxy/mode-goal',
        provides: [{ category: 'mode', name: 'goal' }],
      },
    ]);
    const rerunSlash = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install, catalog } } as never,
        rerunSlash,
        installInFlightRef: { current: false },
      }),
    );
    handle({ kind: 'mode', title: 'Switch mode', options: [] }, 'install::goal');
    await new Promise((r) => setImmediate(r));
    expect(install).toHaveBeenCalledWith('mode-goal');
    expect(rerunSlash).toHaveBeenCalledWith('/mode goal');
  });
});

describe('makePickerHandler — third-party install consent', () => {
  beforeEach(() => {
    vi.mocked(openPluginsPicker).mockClear();
  });

  it('a third-party install opens the consent picker instead of finishing silently', async () => {
    const install = vi.fn(async () => ({
      installed: 'evil-tools@1.0.0',
      registered: { tools: ['hack'] },
      capabilities: {
        declared: 0,
        total: 1,
        surface: {},
        undeclaredTools: ['hack'],
      },
    }));
    const setPicker = vi.fn();
    const setSystemNotice = vi.fn();
    const rerunSlash = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setPicker,
        setSystemNotice,
        rerunSlash,
        installInFlightRef: { current: false },
      }),
    );
    handle(
      { kind: 'install-confirm', title: 't', catalogId: 'evil-tools', rerun: '/x', options: [] },
      'install',
    );
    await new Promise((r) => setImmediate(r));
    // The surface is rendered as the notice, with undeclared tools called out.
    expect(setSystemNotice).toHaveBeenCalledWith(expect.stringContaining('third-party plugin'));
    expect(setSystemNotice).toHaveBeenCalledWith(
      expect.stringContaining('1 of 1 tool declares NO capabilities'),
    );
    // Consent picker opened; the follow-up (rerun) is deferred behind `keep`.
    const consent = setPicker.mock.calls.map((c) => c[0]).find((p) => p?.kind === 'install-consent');
    expect(consent).toMatchObject({ kind: 'install-consent', packageName: 'evil-tools' });
    expect(rerunSlash).not.toHaveBeenCalled();
  });

  it('a first-party install skips consent but shows the capability info line', async () => {
    const install = vi.fn(async () => ({
      installed: '@moxxy/plugin-nice@1.0.0',
      registered: { tools: ['nice'] },
      capabilities: {
        declared: 1,
        total: 1,
        surface: { net: { mode: 'allowlist', hosts: ['api.nice.dev'] } },
      },
    }));
    const setPicker = vi.fn();
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setPicker,
        setSystemNotice,
        installInFlightRef: { current: false },
      }),
    );
    handle(pluginsPicker, 'plugin-nice::install');
    await new Promise((r) => setImmediate(r));
    expect(setSystemNotice).toHaveBeenLastCalledWith(
      expect.stringContaining('network: only these hosts: api.nice.dev'),
    );
    const consent = setPicker.mock.calls.map((c) => c[0]).find((p) => p?.kind === 'install-consent');
    expect(consent).toBeUndefined();
  });

  it('decline disables the package and explains how to re-enable it', async () => {
    const setEnabled = vi.fn(async () => undefined);
    const setSystemNotice = vi.fn();
    const onKeep = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { setEnabled } } as never,
        setSystemNotice,
      }),
    );
    handle(
      {
        kind: 'install-consent',
        title: 't',
        packageName: 'evil-tools',
        options: [],
        onKeep,
      },
      'disable',
    );
    await new Promise((r) => setImmediate(r));
    expect(setEnabled).toHaveBeenCalledWith('evil-tools', false);
    expect(onKeep).not.toHaveBeenCalled();
    expect(setSystemNotice).toHaveBeenCalledWith(
      expect.stringContaining('moxxy plugins enable evil-tools'),
    );
  });

  it('keep leaves the package enabled and runs the deferred follow-up', async () => {
    const setEnabled = vi.fn(async () => undefined);
    const onKeep = vi.fn();
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { setEnabled } } as never,
        setSystemNotice,
      }),
    );
    handle(
      {
        kind: 'install-consent',
        title: 't',
        packageName: 'evil-tools',
        options: [],
        onKeep,
      },
      'keep',
    );
    await new Promise((r) => setImmediate(r));
    expect(setEnabled).not.toHaveBeenCalled();
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(setSystemNotice).toHaveBeenCalledWith(expect.stringContaining('stays enabled'));
  });

  it('the consent picker survives the reopenPluginsPicker flow (deferred reopen)', async () => {
    const install = vi.fn(async () => ({
      installed: 'evil-tools@1.0.0',
      registered: { tools: ['hack'] },
    }));
    const setPicker = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', pluginsAdmin: { install } } as never,
        setPicker,
        setSystemNotice: vi.fn(),
        installInFlightRef: { current: false },
      }),
    );
    handle(pluginsPicker, 'evil-tools::install');
    await new Promise((r) => setImmediate(r));
    // The consent picker must be the LAST picker set — openPluginsPicker
    // (mocked) must not run while consent is pending.
    expect(openPluginsPicker).not.toHaveBeenCalled();
    const last = setPicker.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({ kind: 'install-consent', reopenPluginsPicker: true });
  });
});

describe('makePickerHandler — settings panel', () => {
  const settingsPicker = { kind: 'settings', title: 'Settings', options: [] } as const;

  it('toggles a boolean knob: writes user scope, live-applies, reopens', async () => {
    const { setConfigValue, loadConfig } = await import('@moxxy/config');
    vi.mocked(loadConfig).mockResolvedValue({ config: {}, sources: [] } as never);
    const apply = vi.fn(async () => ({ applied: ['context.caching'], pending: [] }));
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({
        session: { id: 's', configAdmin: { apply } } as never,
        setSystemNotice,
      }),
    );
    handle(settingsPicker, 'caching');
    await new Promise((r) => setImmediate(r));
    expect(vi.mocked(setConfigValue)).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'user', path: 'context.caching', value: false }),
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(setSystemNotice).toHaveBeenCalledWith(expect.stringContaining('Prompt caching → false'));
  });

  it('without configAdmin the write still lands and the notice says restart', async () => {
    const { setConfigValue, loadConfig } = await import('@moxxy/config');
    vi.mocked(loadConfig).mockResolvedValue({ config: {}, sources: [] } as never);
    vi.mocked(setConfigValue).mockClear();
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(
      baseDeps({ session: { id: 's' } as never, setSystemNotice }),
    );
    handle(settingsPicker, 'security');
    await new Promise((r) => setImmediate(r));
    expect(vi.mocked(setConfigValue)).toHaveBeenCalledTimes(1);
    expect(setSystemNotice).toHaveBeenCalledWith(expect.stringContaining('applies on restart'));
  });

  it('readonly rows only explain where to edit', async () => {
    const { setConfigValue } = await import('@moxxy/config');
    vi.mocked(setConfigValue).mockClear();
    const setSystemNotice = vi.fn();
    const handle = makePickerHandler(baseDeps({ setSystemNotice }));
    handle(settingsPicker, 'system-prompt');
    await new Promise((r) => setImmediate(r));
    expect(vi.mocked(setConfigValue)).not.toHaveBeenCalled();
    expect(setSystemNotice).toHaveBeenCalledWith(expect.stringContaining('config.yaml'));
  });
});
