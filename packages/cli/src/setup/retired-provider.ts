import { recordProviderMigrationNotice, replaceProviderName } from '@moxxy/config';

/**
 * "ChatGPT sign-in" (`openai-codex`) reached OpenAI through a private ChatGPT
 * route and is gone. A config that still names it moves to the official
 * "ChatGPT — Codex agent" connection, which runs the person's installed Codex
 * on their own ChatGPT sign-in; without Codex, Moxxy asks for another provider.
 */
export const RETIRED_PROVIDER = 'openai-codex';
export const RETIRED_PROVIDER_REPLACEMENT = 'codex-agent';

export const RETIRED_PROVIDER_NOTICE =
  'ChatGPT sign-in was removed: Moxxy now reaches OpenAI only through official connections. ' +
  'This chat moves to "ChatGPT — Codex agent", which uses your installed Codex.';

export const RETIRED_PROVIDER_NO_CODEX =
  'ChatGPT sign-in was removed: Moxxy now reaches OpenAI only through official connections. ' +
  'Install Codex to use "ChatGPT — Codex agent", add an OpenAI API key, or choose another provider.';

/** The provider walk with the retired provider replaced, and whether it was there. */
export function replaceRetiredProvider(candidates: ReadonlyArray<string>): {
  readonly candidates: ReadonlyArray<string>;
  readonly replaced: boolean;
} {
  if (!candidates.includes(RETIRED_PROVIDER)) return { candidates, replaced: false };
  const next = candidates.map((name) => (name === RETIRED_PROVIDER ? RETIRED_PROVIDER_REPLACEMENT : name));
  return { candidates: [...new Set(next)], replaced: true };
}

/**
 * Once the Codex agent has started in place of the retired ChatGPT sign-in,
 * save that choice in the user config, so the swap (and its notice) happens
 * once, and leave a notice for the desktop to show once. Never stops startup.
 */
export async function persistRetiredProviderMigration(
  logger: { warn(message: string, meta?: Record<string, unknown>): void },
): Promise<void> {
  try {
    if (!(await replaceProviderName(RETIRED_PROVIDER, RETIRED_PROVIDER_REPLACEMENT))) return;
    await recordProviderMigrationNotice({ from: RETIRED_PROVIDER, to: RETIRED_PROVIDER_REPLACEMENT });
  } catch (error) {
    logger.warn('could not save the move from ChatGPT sign-in to the Codex agent', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
