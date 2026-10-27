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
