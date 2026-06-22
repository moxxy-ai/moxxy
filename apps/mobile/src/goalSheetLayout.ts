export interface GoalSheetPlacementInput {
  readonly screenHeight: number;
  readonly topSafeArea?: number;
  readonly keyboardHeight?: number;
}

export interface GoalSheetPlacement {
  readonly top: number;
  readonly maxHeight: number;
  readonly inputMaxHeight: number;
}

export function buildGoalSheetPlacement(input: GoalSheetPlacementInput): GoalSheetPlacement {
  const screenHeight = Math.max(0, input.screenHeight);
  const topSafeArea = Math.max(0, input.topSafeArea ?? 0);
  const keyboardHeight = Math.max(0, input.keyboardHeight ?? 0);
  const top = Math.round(Math.max(topSafeArea + 48, Math.min(168, screenHeight * 0.18)));
  const available = Math.max(220, screenHeight - keyboardHeight - top - 16);
  const maxHeight = Math.min(420, available);

  return {
    top,
    maxHeight,
    inputMaxHeight: Math.max(112, maxHeight - 178),
  };
}
