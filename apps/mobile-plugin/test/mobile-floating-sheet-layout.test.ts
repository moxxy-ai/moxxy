import { describe, expect, it } from 'vitest';
import { buildFloatingSheetPlacement } from '../mobile/src/floatingSheetLayout';

describe('mobile floating sheet placement', () => {
  it('keeps pending decisions above the measured composer instead of the old fixed offset', () => {
    const placement = buildFloatingSheetPlacement({
      composerHeight: 248,
      screenHeight: 844,
      topSafeArea: 59,
    });

    expect(placement.bottom).toBeGreaterThanOrEqual(260);
    expect(placement.bottom).toBeGreaterThan(126);
    expect(placement.maxHeight).toBeLessThanOrEqual(844 - 59 - placement.bottom - 16);
  });

  it('uses a safe composer fallback before the first layout measurement arrives', () => {
    expect(buildFloatingSheetPlacement({
      composerHeight: 0,
      screenHeight: 812,
      topSafeArea: 47,
    })).toMatchObject({
      bottom: 252,
    });
  });
});
