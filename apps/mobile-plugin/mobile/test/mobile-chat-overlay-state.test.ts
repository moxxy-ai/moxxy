import { describe, expect, it } from 'vitest';
import { shouldShowPendingActionsSheet } from '../src/chatOverlayState';

const base = {
  pendingActions: 1,
  composerActionsOpen: false,
  goalsOpen: false,
  compactConfirmOpen: false,
  modelPickerOpen: false,
  modePickerOpen: false,
  sessionActionsOpen: false,
  renameOpen: false,
};

describe('mobile chat overlay state', () => {
  it('shows pending actions only when no user-controlled sheet is active', () => {
    expect(shouldShowPendingActionsSheet(base)).toBe(true);
    expect(shouldShowPendingActionsSheet({ ...base, pendingActions: 0 })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, composerActionsOpen: true })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, goalsOpen: true })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, compactConfirmOpen: true })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, modelPickerOpen: true })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, modePickerOpen: true })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, sessionActionsOpen: true })).toBe(false);
    expect(shouldShowPendingActionsSheet({ ...base, renameOpen: true })).toBe(false);
  });
});
