export interface FloatingSheetPlacementInput {
  readonly composerHeight: number;
  readonly screenHeight: number;
  readonly topSafeArea: number;
  readonly gap?: number;
  readonly fallbackComposerHeight?: number;
}

export interface FloatingSheetPlacement {
  readonly bottom: number;
  readonly maxHeight: number;
}

const DEFAULT_COMPOSER_HEIGHT = 240;
const DEFAULT_GAP = 12;
const TOP_GAP = 16;
const SHEET_MAX_HEIGHT = 420;

export function buildFloatingSheetPlacement(input: FloatingSheetPlacementInput): FloatingSheetPlacement {
  const composerHeight =
    input.composerHeight > 0 ? input.composerHeight : input.fallbackComposerHeight ?? DEFAULT_COMPOSER_HEIGHT;
  const bottom = Math.ceil(composerHeight + (input.gap ?? DEFAULT_GAP));
  const availableHeight = Math.max(0, input.screenHeight - input.topSafeArea - bottom - TOP_GAP);

  return {
    bottom,
    maxHeight: Math.min(availableHeight, SHEET_MAX_HEIGHT),
  };
}
