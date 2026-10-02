import type { ComputerControlService, PendingToolCall, PermissionContext } from '@moxxy/sdk';
import type { AskResponse } from '@moxxy/desktop-ipc-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withComputerApprovalFocus } from './computer-approval-focus.js';

type FocusInput = Parameters<NonNullable<ComputerControlService['approvalFocus']>>[0];

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true });

function service(seen: FocusInput[]): ComputerControlService {
  return {
    approvalFocus: async (input: FocusInput) => { seen.push(input); return { restored: true, reason: '' }; },
  } as unknown as ComputerControlService;
}

const call = (name: string, input: unknown) => ({ callId: 'call-1', name, input }) as unknown as PendingToolCall;
const context = { turnId: 'turn-1' } as unknown as PermissionContext;
const answer = (mode: string) => async () => ({ mode }) as unknown as AskResponse;

describe('withComputerApprovalFocus', () => {
  beforeEach(() => setPlatform('win32'));
  afterEach(() => { if (platform) Object.defineProperty(process, 'platform', platform); });

  it('brackets the prompt of an action on an app with begin and an approved finish', async () => {
    const seen: FocusInput[] = [];
    await withComputerApprovalFocus(service(seen), 'session-1', call('computer_click', { app: 'c:\\apps\\notes.exe', element_index: 3 }), context, undefined, answer('allow'));
    expect(seen.map((input) => [input.stage, input.approved, input.windowId, input.callId])).toEqual([
      ['begin', false, 'c:\\apps\\notes.exe', 'call-1'],
      ['finish', true, 'c:\\apps\\notes.exe', 'call-1'],
    ]);
  });

  it('does not bring the app back after a denial', async () => {
    const seen: FocusInput[] = [];
    await withComputerApprovalFocus(service(seen), 'session-1', call('computer_type_text', { app: 'notes', text: 'x' }), context, undefined, answer('deny'));
    expect(seen.map((input) => input.approved)).toEqual([false, false]);
  });

  it('leaves tools that send no input, and other platforms, alone', async () => {
    const seen: FocusInput[] = [];
    await withComputerApprovalFocus(service(seen), 'session-1', call('computer_get_app_state', { app: 'notes' }), context, undefined, answer('allow'));
    await withComputerApprovalFocus(service(seen), 'session-1', call('computer_click', { element_index: 3 }), context, undefined, answer('allow'));
    setPlatform('darwin');
    await withComputerApprovalFocus(service(seen), 'session-1', call('computer_click', { app: 'notes' }), context, undefined, answer('allow'));
    expect(seen).toEqual([]);
  });
});
