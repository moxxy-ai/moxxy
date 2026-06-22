import { describe, expect, it } from 'vitest';
import { buildGoalSheetPlacement } from '../src/goalSheetLayout';
import { buildModeSelectorUiState } from '../src/modeSelector';

describe('mobile mode selector ui model', () => {
  it('builds a visible mode chip and selectable rows from session info', () => {
    const ui = buildModeSelectorUiState({
      modes: ['default', 'goal', 'research'],
      activeMode: 'goal',
      activeModeBadge: { label: 'GOAL', tone: 'attention' },
    });

    expect(ui).toMatchObject({
      chipLabel: 'goal',
      disabled: false,
      banner: {
        label: 'GOAL',
        tone: 'attention',
        description: 'GOAL mode active - the agent keeps working autonomously toward your objective.',
      },
    });
    expect(ui.modeRows).toEqual([
      { id: 'default', label: 'default', active: false },
      { id: 'goal', label: 'goal', active: true },
      { id: 'research', label: 'research', active: false },
    ]);
  });

  it('disables the chip when the runner has not advertised modes yet', () => {
    expect(buildModeSelectorUiState({
      modes: [],
      activeMode: null,
      activeModeBadge: null,
    })).toMatchObject({
      chipLabel: 'Mode',
      disabled: true,
      modeRows: [],
      banner: null,
    });
  });
});

describe('mobile goal sheet placement', () => {
  it('keeps the goal sheet high enough that its input remains visible above the iOS keyboard', () => {
    const placement = buildGoalSheetPlacement({
      screenHeight: 844,
      topSafeArea: 59,
      keyboardHeight: 336,
    });

    expect(placement.top).toBeLessThanOrEqual(160);
    expect(placement.maxHeight).toBeLessThanOrEqual(844 - 336 - placement.top - 16);
    expect(placement.maxHeight).toBeGreaterThanOrEqual(280);
  });

  it('centers the sheet higher on tall screens when the keyboard is hidden', () => {
    expect(buildGoalSheetPlacement({
      screenHeight: 932,
      topSafeArea: 59,
      keyboardHeight: 0,
    })).toMatchObject({
      top: 168,
      maxHeight: 420,
    });
  });
});
