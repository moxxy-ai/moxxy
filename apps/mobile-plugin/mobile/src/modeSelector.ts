export interface MobileModeBadge {
  readonly label: string;
  readonly tone?: 'attention' | 'info';
}

export interface ModeSelectorUiInput {
  readonly modes: ReadonlyArray<string>;
  readonly activeMode: string | null;
  readonly activeModeBadge: MobileModeBadge | null;
}

export interface ModeSelectorUiState {
  readonly chipLabel: string;
  readonly disabled: boolean;
  readonly modeRows: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly active: boolean;
  }>;
  readonly banner: {
    readonly label: string;
    readonly tone: 'attention' | 'info';
    readonly description: string;
  } | null;
}

export function buildModeSelectorUiState(input: ModeSelectorUiInput): ModeSelectorUiState {
  const badge = normalizeBadge(input.activeModeBadge);
  return {
    chipLabel: input.activeMode ?? 'Mode',
    disabled: input.modes.length === 0,
    modeRows: input.modes.map((mode) => ({
      id: mode,
      label: mode,
      active: mode === input.activeMode,
    })),
    banner: badge
      ? {
          label: badge.label,
          tone: badge.tone,
          description: `${badge.label} mode active - the agent keeps working autonomously toward your objective.`,
        }
      : null,
  };
}

function normalizeBadge(value: MobileModeBadge | null): {
  readonly label: string;
  readonly tone: 'attention' | 'info';
} | null {
  const label = value?.label?.trim();
  if (!label) return null;
  return {
    label,
    tone: value?.tone === 'attention' ? 'attention' : 'info',
  };
}
