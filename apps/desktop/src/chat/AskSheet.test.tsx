/**
 * AskSheet is the security-critical, runner-BLOCKING consent gate. These tests
 * pin the worst-case operability path: focus is moved into the sheet on appear
 * (onto the SAFE default), Tab is trapped inside it, Escape resolves to the
 * safe verdict, and focus is restored to the opener on close.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import { assertDefined } from '@moxxy/sdk';

const respond = vi.fn();
vi.mock('@moxxy/client-core', () => ({
  askStore: { respond: (...a: unknown[]) => respond(...a) },
}));

import { AskSheet } from './AskSheet';

beforeEach(() => {
  respond.mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
});

const permissionAsk: AskRequest = {
  requestId: 'r1',
  workspaceId: 'w1',
  kind: 'permission',
  tool: { name: 'Bash', input: { command: 'rm -rf /' }, description: 'run a command' },
};

const approvalAsk: AskRequest = {
  requestId: 'r2',
  workspaceId: 'w1',
  kind: 'approval',
  approval: {
    title: 'Approve plan',
    body: 'do the thing',
    defaultOptionId: 'yes',
    options: [
      { id: 'yes', label: 'Approve' },
      { id: 'no', label: 'Reject', danger: true },
    ],
  },
};

describe('AskSheet — permission gate operability', () => {
  it('moves focus onto Deny (the safe default) on appear', () => {
    render(<AskSheet ask={permissionAsk} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deny' }));
  });

  it('Escape denies (safe default) instead of leaving the turn parked', () => {
    const { container } = render(<AskSheet ask={permissionAsk} />);
    const dialog = container.querySelector('[role="dialog"]');
    assertDefined(dialog, 'permission dialog element');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(respond).toHaveBeenCalledWith('r1', { mode: 'deny' });
  });

  it('exposes a real modal dialog (aria-modal) for assistive tech', () => {
    render(<AskSheet ask={permissionAsk} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Permission required');
  });

  it('restores focus to the opener when the sheet unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<AskSheet ask={permissionAsk} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside the sheet (Tab off the last button cycles to the first)', () => {
    render(<AskSheet ask={permissionAsk} />);
    const deny = screen.getByRole('button', { name: 'Deny' });
    const always = screen.getByRole('button', { name: 'Always allow' });
    always.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(deny);
  });
});

describe('AskSheet — approval gate operability', () => {
  it('focuses the (non-danger) default option on appear', () => {
    render(<AskSheet ask={approvalAsk} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve' }));
  });

  it('Escape picks the default option only when it is NOT destructive', () => {
    render(<AskSheet ask={approvalAsk} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(respond).toHaveBeenCalledWith('r2', { optionId: 'yes' });
  });

  it('Escape never auto-confirms when the default option is destructive', () => {
    assertDefined(approvalAsk.approval, 'approval payload');
    const dangerDefault: AskRequest = {
      ...approvalAsk,
      requestId: 'r3',
      approval: {
        ...approvalAsk.approval,
        defaultOptionId: 'no',
        options: [
          { id: 'yes', label: 'Approve' },
          { id: 'no', label: 'Reject', danger: true },
        ],
      },
    };
    render(<AskSheet ask={dangerDefault} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(respond).not.toHaveBeenCalled();
  });
});
