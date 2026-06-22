export interface ComposerDraftState {
  readonly text: string;
  readonly inputResetKey: number;
}

export function createComposerDraft(): ComposerDraftState {
  return {
    text: '',
    inputResetKey: 0,
  };
}

export function updateComposerDraftText(state: ComposerDraftState, text: string): ComposerDraftState {
  if (state.text === text) return state;
  return {
    ...state,
    text,
  };
}

export function submitComposerDraft(state: ComposerDraftState): ComposerDraftState {
  return {
    text: '',
    inputResetKey: state.inputResetKey + 1,
  };
}
