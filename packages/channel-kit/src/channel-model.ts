import {
  applyModelChoice,
  findModelOptions,
  formatModelChoice,
  listModelOptions,
  parseModelChoice,
  type ModelChoice,
  type ModelOption,
  type ModelSwitchSession,
} from './model-choice.js';

/**
 * A channel bot's own model: a channel-scoped choice (`<channel>_model` in the
 * vault — the key the desktop's channel panel writes too) — NOT the global
 * default, so switching the bot's model never changes what the desktop/TUI run
 * with. Read before every turn, so a change made from the desktop panel or
 * `/model` applies to the next message without a restart.
 */

export interface ModelCommandDeps {
  readonly session: ModelSwitchSession;
  readonly vault: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<boolean>;
  };
  /** The vault key this channel keeps its choice under (`discord_model`, …). */
  readonly vaultKey: string;
}

/** Lines of choices a reply lists (fits the smallest messenger cap, 2000 chars). */
const LIST_CAP = 25;

/** The model this channel saved, or null when it runs the default model. */
export async function savedChannelModel(deps: ModelCommandDeps): Promise<ModelChoice | null> {
  return parseModelChoice(await deps.vault.get(deps.vaultKey));
}


function isSame(a: ModelChoice | null, b: ModelChoice): boolean {
  return a != null && a.provider === b.provider && a.model === b.model;
}

function renderList(options: ReadonlyArray<ModelOption>, current: ModelChoice | null): string {
  const shown = options.slice(0, LIST_CAP).map((o) => {
    const mark = isSame(current, o) ? '• ' : '  ';
    return `${mark}${formatModelChoice(o)}${o.connected ? '' : ' (not connected)'}`;
  });
  const hidden = options.length - shown.length;
  return shown.join('\n') + (hidden > 0 ? `\n  … ${hidden} more — narrow with /model <text>` : '');
}

/** `/model [name|default]` — show, switch, or reset this bot's model. */
export async function runModelCommand(arg: string, deps: ModelCommandDeps): Promise<string> {
  const query = arg.trim();
  const current = await savedChannelModel(deps);
  const options = listModelOptions(deps.session);

  if (!query) {
    const heading = current
      ? `Model: ${formatModelChoice(current)} (this bot)`
      : `Model: default (${deps.session.providers.getActiveName() ?? 'no provider'})`;
    return `${heading}\n\n${renderList(options, current)}\n\nSwitch with /model <name>, reset with /model default.`;
  }

  if (query.toLowerCase() === 'default') {
    await deps.vault.delete(deps.vaultKey);
    return '✓ back to the default model.';
  }

  const matches = findModelOptions(options, query);
  if (matches.length === 0) return `no model matches "${query}" — send /model to see the list.`;
  if (matches.length > 1) return `"${query}" matches several models — be more specific:\n${renderList(matches, current)}`;

  const [picked] = matches as [ModelOption];
  const applied = await applyModelChoice(deps.session, picked);
  if (!applied.ok) return applied.message;
  await deps.vault.set(deps.vaultKey, formatModelChoice(picked));
  return `✓ switched to ${formatModelChoice(picked)} for this bot.`;
}

/** One entry a model picker shows (Discord's `/model name:` caps a response at 25). */
export interface ModelSuggestion {
  readonly name: string;
  readonly value: string;
}

const SUGGESTION_CAP = 25;
/** Discord limits a choice's label and value to 100 chars; others fit it too. */
const CHOICE_TEXT_CAP = 100;

/**
 * Autocomplete for `/model name:` — the models matching what's typed so far,
 * so the user picks one instead of typing `provider::model` by hand. The value
 * is the exact `provider::model`, which `runModelCommand` switches to.
 */
export async function modelSuggestions(query: string, deps: ModelCommandDeps): Promise<ModelSuggestion[]> {
  const q = query.trim().toLowerCase();
  const current = await savedChannelModel(deps);
  const models = listModelOptions(deps.session)
    .filter((o) => formatModelChoice(o).toLowerCase().includes(q))
    .map((o) => {
      const value = formatModelChoice(o);
      const note = isSame(current, o) ? ' (current)' : o.connected ? '' : ' (not connected)';
      return { name: `${value}${note}`.slice(0, CHOICE_TEXT_CAP), value: value.slice(0, CHOICE_TEXT_CAP) };
    });
  const reset = 'default'.includes(q) ? [{ name: 'default', value: 'default' }] : [];
  return [...reset, ...models].slice(0, SUGGESTION_CAP);
}

/**
 * The model for the next turn. `{}` = the default model; a saved choice whose
 * provider can't be activated falls back to the default with a warning to show.
 */
export async function resolveChannelModel(
  deps: ModelCommandDeps,
): Promise<{ readonly model?: string; readonly warning?: string }> {
  const choice = await savedChannelModel(deps);
  if (!choice) return {};
  const applied = await applyModelChoice(deps.session, choice);
  if (!applied.ok) {
    return { warning: `Can't use ${formatModelChoice(choice)} (${applied.message}) — using the default model.` };
  }
  return { model: choice.model };
}
