import {
  listModelOptions,
  resolveChannelModel,
  runModelCommand,
  savedChannelModel,
  type ModelChoice,
  type ModelCommandDeps,
  type ModelOption,
} from '@moxxy/channel-kit';
import { TELEGRAM_MODEL_KEY } from '../keys.js';

/**
 * The Telegram bot's own model (`telegram_model` in the vault, the key the
 * desktop panel writes too): `/model` and its buttons switch it, and it is read
 * before every turn — never the global default the desktop/TUI run with.
 */
export interface TelegramModel {
  /** `/model [name|default]` — switch or reset; returns the reply. */
  run(arg: string): Promise<string>;
  /** What the picker shows: the saved choice and every model. */
  choices(): Promise<{ readonly current: ModelChoice | null; readonly options: ReadonlyArray<ModelOption> }>;
  /** The model for the next turn, with a warning when the saved one can't be used. */
  resolve(): Promise<{ readonly model?: string; readonly warning?: string }>;
}

export function telegramModel(deps: Omit<ModelCommandDeps, 'vaultKey'>): TelegramModel {
  const scoped: ModelCommandDeps = { ...deps, vaultKey: TELEGRAM_MODEL_KEY };
  return {
    run: (arg) => runModelCommand(arg, scoped),
    choices: async () => ({ current: await savedChannelModel(scoped), options: listModelOptions(deps.session) }),
    resolve: () => resolveChannelModel(scoped),
  };
}
