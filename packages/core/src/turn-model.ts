import { startingModel } from '@moxxy/sdk';

/** What decides the model of a turn that names none. */
export interface TurnModelSource {
  readonly lastResolvedModel: string | null;
  /** The provider that model belongs to; `null` when unknown (then the model is taken as the active provider's). */
  readonly lastResolvedProvider?: string | null;
  readonly defaultModels?: Readonly<Record<string, string>>;
}

/**
 * The model a turn runs on: the one it names, else the one the conversation
 * last ran on with this provider, else the one set as the provider's default,
 * else the provider's light starter model, else the first the provider lists.
 * A model of another provider is never reused: after the conversation switches
 * provider it would only fail.
 */
export function resolveTurnModel(
  session: TurnModelSource,
  provider: {
    readonly name: string;
    readonly models: ReadonlyArray<{ readonly id: string }>;
    readonly starterModel?: string;
  },
  named?: string,
): string | undefined {
  const configured = session.defaultModels ? session.defaultModels[provider.name] : undefined;
  const last = session.lastResolvedProvider && session.lastResolvedProvider !== provider.name ? null : session.lastResolvedModel;
  return named ?? last ?? configured ?? startingModel(provider);
}
