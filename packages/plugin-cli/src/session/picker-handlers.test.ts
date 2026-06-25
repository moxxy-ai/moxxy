import { describe, expect, it, vi } from 'vitest';
import { makePickerHandler, type PickerHandlerDeps } from './picker-handlers.js';
import { NEW_SESSION_OPTION_ID } from './sessions-picker.js';

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
