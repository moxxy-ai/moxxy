export interface ContextMeterUiInput {
  readonly latestPrompt: number | null;
  readonly contextWindow: number | null;
}

export interface ContextMeterUiState {
  readonly visible: boolean;
  readonly label: string;
  readonly fraction: number | null;
  readonly fillPercent: number;
  readonly tone: 'neutral' | 'primary' | 'amber' | 'red';
}

export function buildContextMeterUiState(input: ContextMeterUiInput): ContextMeterUiState {
  if (!input.contextWindow || input.contextWindow <= 0) {
    return {
      visible: false,
      label: 'Context',
      fraction: null,
      fillPercent: 0,
      tone: 'neutral',
    };
  }
  const fraction = Math.max(0, Math.min(1, (input.latestPrompt ?? 0) / input.contextWindow));
  return {
    visible: true,
    label: `${Math.round(fraction * 100)}%`,
    fraction,
    fillPercent: Math.round(fraction * 100),
    tone: fraction >= 0.85 ? 'red' : fraction >= 0.6 ? 'amber' : 'primary',
  };
}
