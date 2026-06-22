export interface MobileProviderInfo {
  readonly name: string;
  readonly models: ReadonlyArray<{ readonly id: string }>;
}

export interface ModelSelectorUiInput {
  readonly providers: ReadonlyArray<MobileProviderInfo>;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly selectedProvider?: string | null;
}

export interface ModelSelectorUiState {
  readonly chipLabel: string;
  readonly disabled: boolean;
  readonly selectedProvider: string;
  readonly providerRows: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly active: boolean;
    readonly selected: boolean;
  }>;
  readonly modelRows: ReadonlyArray<{
    readonly id: string | null;
    readonly label: string;
    readonly active: boolean;
  }>;
}

export function buildModelSelectorUiState(input: ModelSelectorUiInput): ModelSelectorUiState {
  const providerNames = new Set(input.providers.map((provider) => provider.name));
  const selectedProvider = input.selectedProvider && providerNames.has(input.selectedProvider)
    ? input.selectedProvider
    : input.activeProvider && providerNames.has(input.activeProvider)
      ? input.activeProvider
      : input.providers[0]?.name ?? '';
  const selectedProviderInfo = input.providers.find((provider) => provider.name === selectedProvider);
  const activeSelection = selectedProvider === input.activeProvider;

  return {
    chipLabel: input.activeProvider
      ? input.activeModel
        ? `${input.activeProvider}/${input.activeModel}`
        : input.activeProvider
      : 'pick',
    disabled: input.providers.length === 0,
    selectedProvider,
    providerRows: input.providers.map((provider) => ({
      id: provider.name,
      label: provider.name,
      active: provider.name === input.activeProvider,
      selected: provider.name === selectedProvider,
    })),
    modelRows: selectedProviderInfo
      ? [
          {
            id: null,
            label: 'Default',
            active: activeSelection && input.activeModel === null,
          },
          ...selectedProviderInfo.models.map((model) => ({
            id: model.id,
            label: model.id,
            active: activeSelection && input.activeModel === model.id,
          })),
        ]
      : [],
  };
}
