export interface PendingActionsSheetStateInput {
  readonly pendingActions: number;
  readonly composerActionsOpen: boolean;
  readonly goalsOpen: boolean;
  readonly compactConfirmOpen: boolean;
  readonly modelPickerOpen: boolean;
  readonly modePickerOpen: boolean;
  readonly sessionActionsOpen: boolean;
  readonly renameOpen: boolean;
}

export function shouldShowPendingActionsSheet(input: PendingActionsSheetStateInput): boolean {
  return (
    input.pendingActions > 0 &&
    !input.composerActionsOpen &&
    !input.goalsOpen &&
    !input.compactConfirmOpen &&
    !input.modelPickerOpen &&
    !input.modePickerOpen &&
    !input.sessionActionsOpen &&
    !input.renameOpen
  );
}
