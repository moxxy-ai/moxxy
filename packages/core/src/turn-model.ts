/** What decides the model of a turn that names none. */
export interface TurnModelSource {
  readonly lastResolvedModel: string | null;
  readonly defaultModels?: Readonly<Record<string, string>>;
}

/**
 * The model a turn runs on: the one it names, else the one the conversation
 * last ran on, else the one set as the provider's default, else the first the
 * provider lists.
 */
export function resolveTurnModel(
  session: TurnModelSource,
  provider: { readonly name: string; readonly models: ReadonlyArray<{ readonly id: string }> },
  named?: string,
): string | undefined {
  const configured = session.defaultModels ? session.defaultModels[provider.name] : undefined;
  return named ?? session.lastResolvedModel ?? configured ?? provider.models[0]?.id;
}
