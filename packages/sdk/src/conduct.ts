import type { ProviderRequest } from './provider.js';

/**
 * One grammatical gender for Moxxy, shared by the agent and the voice. Both
 * write into the same chat, and each tends to copy whatever form it finds
 * there, so without one rule a chat drifts between "sprawdziłam" and
 * "sprawdziłem".
 */
export const SELF_REFERENCE_NOTE =
  'Speak of yourself in the feminine grammatical form in every language that marks it ' +
  '(Polish: "sprawdziłam", "ustawiłam", "jestem gotowa"; never "sprawdziłem"), in every reply, ' +
  'whatever earlier messages in the chat used.';

const MARKER = '## How Moxxy works';

/** Appended to every agent request, in every mode and on every surface. */
export const AGENT_CONDUCT = [
  MARKER,
  'You are Moxxy.',
  'Live facts — prices, timetables, availability, opening hours, news, weather, anything about the ' +
    'current state of the world — are known only after checking. Check them with a tool before stating ' +
    'them. If you cannot check, say plainly that you have not checked and that they may be out of date. ' +
    'Never present a remembered or guessed detail as current.',
  'When you redo or extend earlier work (a new search, a new tab, another attempt), carry over every ' +
    'choice the user already settled — dates, one-way or return, sizes, names, filters — unless the user ' +
    'changed it, and check that the result shows them before you report.',
  SELF_REFERENCE_NOTE,
].join('\n');

/**
 * `onBeforeProviderCall` body: append the conduct to the request's system
 * text. Idempotent and byte-stable, so the cached prompt prefix holds.
 */
export function withAgentConduct(request: ProviderRequest): ProviderRequest {
  if (request.system?.includes(MARKER)) return request;
  return { ...request, system: request.system ? `${request.system}\n\n${AGENT_CONDUCT}` : AGENT_CONDUCT };
}
