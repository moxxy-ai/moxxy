import { InlineKeyboard } from 'grammy';
import { formatModelChoice, type ModelChoice, type ModelOption } from '@moxxy/channel-kit';
import { escapeHtml } from '../format.js';

/**
 * The `/model` picker as two screens in one message: the providers, then the
 * models of the one tapped (with a way back). The bot's current choice is the
 * green button.
 */
export interface PickerScreen {
  /** HTML (`parse_mode: 'HTML'`). */
  readonly text: string;
  readonly keyboard: InlineKeyboard;
}

/** Callback data prefix of a provider button; empty provider = back to the list. */
export const PROVIDER_PREFIX = 'mprov:';
/** Telegram rejects a button whose callback data exceeds 64 bytes. */
const CALLBACK_DATA_MAX_BYTES = 64;
/** A provider's models shown at once; the rest are reachable with /model <text>. */
const MODELS_CAP = 30;

const fits = (data: string) => Buffer.byteLength(data) <= CALLBACK_DATA_MAX_BYTES;

function nowLine(current: ModelChoice | null): string {
  return current ? `Now: <code>${escapeHtml(formatModelChoice(current))}</code>` : 'Now: the default model';
}

export function providerScreen(current: ModelChoice | null, options: ReadonlyArray<ModelOption>): PickerScreen {
  const keyboard = new InlineKeyboard().text(current ? 'Default model' : '✓ Default model', 'model:default');
  if (!current) keyboard.success();
  keyboard.row();
  const providers = [...new Set(options.map((o) => o.provider))];
  providers.forEach((provider, index) => {
    const models = options.filter((o) => o.provider === provider);
    const connected = models.some((o) => o.connected);
    const isCurrent = current?.provider === provider;
    const label = `${isCurrent ? '✓ ' : ''}${provider} · ${
      connected ? `${models.length} ${models.length === 1 ? 'model' : 'models'}` : 'not connected'
    }`;
    if (!fits(`${PROVIDER_PREFIX}${provider}`)) return;
    keyboard.text(label, `${PROVIDER_PREFIX}${provider}`);
    if (isCurrent) keyboard.success();
    if (index % 2 === 1) keyboard.row();
  });
  return {
    text: `<b>Model for this bot</b>\n${nowLine(current)}\n\nPick a provider:`,
    keyboard,
  };
}

export function modelScreen(
  provider: string,
  current: ModelChoice | null,
  options: ReadonlyArray<ModelOption>,
): PickerScreen {
  const models = options.filter((o) => o.provider === provider && fits(`model:${formatModelChoice(o)}`));
  const shown = models.slice(0, MODELS_CAP);
  const keyboard = new InlineKeyboard();
  for (const o of shown) {
    const isCurrent = current != null && formatModelChoice(current) === formatModelChoice(o);
    keyboard.text(`${isCurrent ? '✓ ' : ''}${o.model}`, `model:${formatModelChoice(o)}`);
    if (isCurrent) keyboard.success();
    keyboard.row();
  }
  keyboard.text('‹ Providers', PROVIDER_PREFIX);
  const connected = models.some((o) => o.connected);
  const more = models.length - shown.length;
  return {
    text:
      `<b>${escapeHtml(provider)}</b>${connected ? '' : ' · not connected'}\n${nowLine(current)}\n\nPick a model:` +
      (more > 0 ? `\n<i>${more} more — use /model &lt;text&gt;</i>` : ''),
    keyboard,
  };
}
