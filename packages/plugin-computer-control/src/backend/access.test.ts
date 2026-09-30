import type { MoxxyEvent } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import {
  REQUEST_ACCESS_TOOL, accessFromLog, categorize, checkAccess, checkKeys, defaultTier, requiredTier, type AccessGrant, type AccessTier,
} from './access.js';
import type { BatchAction } from '../contract/tools.js';
import { memoryLog } from './helper.fixture.js';

let seq = 0;
const base = (turnId = 't1') => ({ id: `e${seq}`, seq: seq++, ts: 0, sessionId: 's', turnId, source: 'system' }) as const;

const record = (callId: string, output: unknown, opts: { name?: string; approved?: boolean; ok?: boolean } = {}): MoxxyEvent[] => [
  { ...base(), type: 'tool_call_requested', callId, name: opts.name ?? REQUEST_ACCESS_TOOL, input: {} },
  ...(opts.approved === false
    ? [{ ...base(), type: 'tool_call_denied', callId, decidedBy: 'resolver', reason: 'no' } as MoxxyEvent]
    : [{ ...base(), type: 'tool_call_approved', callId, decidedBy: 'resolver', mode: 'allow' } as MoxxyEvent]),
  { ...base(), type: 'tool_result', callId, ok: opts.ok ?? true, output },
] as MoxxyEvent[];

const grant = (granted: AccessGrant['granted'], flags: Partial<AccessGrant> = {}): AccessGrant => ({
  kind: 'computer_access', granted, unresolved: [], clipboard_read: false, clipboard_write: false, system_key_combos: false, ...flags,
});
const textEdit = { id: 'com.apple.TextEdit', name: 'TextEdit', tier: 'full' } as const;
const safari = { id: 'com.apple.Safari', name: 'Safari', tier: 'read' } as const;

describe('categorize and defaultTier', () => {
  it.each([
    [{ id: 'com.apple.Safari', name: 'Safari' }, 'browser'],
    [{ id: 'com.google.Chrome.canary', name: 'Google Chrome Canary' }, 'browser'],
    [{ id: 'chrome.exe', name: 'Google Chrome' }, 'browser'],
    [{ id: 'com.jetbrains.pycharm', name: 'PyCharm' }, 'terminal'],
    [{ id: 'WindowsTerminal.exe', name: 'Windows Terminal' }, 'terminal'],
    [{ id: 'com.tradingview.tradingviewapp.desktop', name: 'TradingView' }, 'trading'],
    [{ id: 'com.example.kb', name: 'Knowledge Edge Notes' }, null],
    [{ id: 'com.apple.TextEdit', name: 'TextEdit' }, null],
    [{ id: 'com.blackmagic-design.DaVinciResolve', name: 'DaVinci Resolve' }, null],
  ] as const)('%j is %s', (app, category) => {
    expect(categorize(app)).toBe(category);
  });

  it('limits browsers and trading to reading and terminals to clicking', () => {
    expect(defaultTier('browser')).toBe('read');
    expect(defaultTier('trading')).toBe('read');
    expect(defaultTier('terminal')).toBe('click');
    expect(defaultTier(null)).toBe('full');
  });
});

describe('requiredTier', () => {
  it.each<[BatchAction, AccessTier]>([
    [{ action: 'click', element_index: 1, mouse_button: 'left', click_count: 2 }, 'click'],
    [{ action: 'click', element_index: 1, mouse_button: 'right', click_count: 1 }, 'full'],
    [{ action: 'click', element_index: 1, mouse_button: 'left', click_count: 1, modifiers: 'cmd' }, 'full'],
    [{ action: 'scroll', element_index: 1, direction: 'down', pages: 1 }, 'click'],
    [{ action: 'type_text', text: 'x' }, 'full'],
    [{ action: 'drag', path: [[0, 0], [1, 1]], mouse_button: 'left' }, 'full'],
    [{ action: 'wait', duration_s: 1 }, 'read'],
  ])('%j needs %s', (step, tier) => {
    expect(requiredTier(step)).toBe(tier);
  });
});

describe('accessFromLog', () => {
  it('starts with nothing granted', () => {
    expect(accessFromLog(memoryLog([])).apps).toEqual([]);
  });

  it('folds approved request results, later grants winning and flags accumulating', () => {
    const log = memoryLog([
      ...record('c1', grant([textEdit, safari])),
      ...record('c2', grant([{ ...safari, tier: 'full' }], { clipboard_write: true })),
      ...record('c3', grant([], { system_key_combos: true })),
    ]);
    const access = accessFromLog(log);
    expect(access.apps).toEqual([textEdit, { ...safari, tier: 'full' }]);
    expect(access.flags).toEqual({ clipboardRead: false, clipboardWrite: true, systemKeyCombos: true });
  });

  it('ignores denied, failed, foreign and malformed records', () => {
    const log = memoryLog([
      ...record('d1', grant([textEdit]), { approved: false, ok: false }),
      ...record('d2', grant([textEdit]), { ok: false }),
      ...record('d3', grant([textEdit]), { name: 'computer_list_apps' }),
      ...record('d4', { kind: 'computer_access', granted: 'everything' }),
    ]);
    expect(accessFromLog(log).apps).toEqual([]);
  });

  it('ignores a result whose request was never approved', () => {
    const events = record('d5', grant([textEdit])).filter((event) => event.type !== 'tool_call_approved');
    expect(accessFromLog(memoryLog(events)).apps).toEqual([]);
  });
});

describe('checkAccess', () => {
  const access = accessFromLog(memoryLog([
    ...record('c1', grant([textEdit, safari, { id: 'a.one', name: 'Notes', tier: 'full' }, { id: 'a.two', name: 'Notes', tier: 'full' }])),
  ]));

  it('finds a grant by identifier or display name, case-insensitively', () => {
    expect(checkAccess(access, 'textedit', 'full')).toEqual(textEdit);
    expect(checkAccess(access, 'COM.APPLE.SAFARI', 'read')).toEqual(safari);
  });

  it('refuses an app that was never granted', () => {
    expect(() => checkAccess(access, 'Mail', 'read')).toThrow(expect.objectContaining({ code: 'app_not_allowed' }));
  });

  it('refuses an action above the granted level and says which level it has', () => {
    expect(() => checkAccess(access, 'Safari', 'click')).toThrow(expect.objectContaining({ code: 'tier_insufficient', message: expect.stringMatching(/Safari.*read.*click/) }));
  });

  it('asks for an identifier when two grants share a name', () => {
    expect(() => checkAccess(access, 'Notes', 'read')).toThrow(expect.objectContaining({ code: 'ambiguous_app' }));
    expect(checkAccess(access, 'a.two', 'read').id).toBe('a.two');
  });
});

describe('checkKeys', () => {
  const none = { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false };

  it('blocks system chords without their grant', () => {
    expect(() => checkKeys({ action: 'press_key', key: 'super+q', repeat: 1 }, none, 'darwin')).toThrow(expect.objectContaining({ code: 'system_key_combo' }));
    expect(() => checkKeys({ action: 'press_key', key: 'super+q', repeat: 1 }, { ...none, systemKeyCombos: true }, 'darwin')).not.toThrow();
    expect(() => checkKeys({ action: 'hold_key', key: 'alt+F4', duration_s: 1 }, none, 'win32')).toThrow(expect.objectContaining({ code: 'system_key_combo' }));
  });

  it('blocks clipboard chords without their grant', () => {
    expect(() => checkKeys({ action: 'press_key', key: 'super+v', repeat: 1 }, none, 'darwin')).toThrow(expect.objectContaining({ code: 'clipboard_not_granted' }));
    expect(() => checkKeys({ action: 'press_key', key: 'super+v', repeat: 1 }, { ...none, clipboardRead: true }, 'darwin')).not.toThrow();
  });

  it('lets ordinary keys and non-key steps through', () => {
    expect(() => checkKeys({ action: 'press_key', key: 'Return', repeat: 1 }, none, 'darwin')).not.toThrow();
    expect(() => checkKeys({ action: 'type_text', text: 'x' }, none, 'darwin')).not.toThrow();
  });
});
