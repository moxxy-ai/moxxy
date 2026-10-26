/**
 * The model a new conversation starts on while the person chose no default:
 * the provider's light starter model when it lists it, else the first it
 * lists. One rule for the runner and for every surface that shows or picks it.
 */
export function startingModel(provider: {
  readonly models: ReadonlyArray<{ readonly id: string }>;
  readonly starterModel?: string;
}): string | undefined {
  return provider.models.find((model) => model.id === provider.starterModel)?.id ?? provider.models[0]?.id;
}
