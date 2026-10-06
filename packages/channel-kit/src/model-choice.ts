import type { ClientSession, SessionLike } from '@moxxy/sdk';

/**
 * Model selection shared by messaging channels (`/model` in chat, a channel's
 * persisted model). A choice is serialized as `provider::model` — the same
 * shape the TUI and Telegram pickers use for their option ids.
 *
 * Deliberately storage-free: each channel decides where its choice lives (a
 * channel-scoped vault key, not the global config, so picking a model for a
 * bot never changes the model the desktop/TUI run with).
 */

export interface ModelChoice {
  readonly provider: string;
  readonly model: string;
}

export interface ModelOption extends ModelChoice {
  /** The provider's credentials resolved at boot, so switching to it works. */
  readonly connected: boolean;
}

export type ApplyModelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknown-provider' | 'not-connected'; readonly message: string };

/** The session surface model switching needs (a core Session satisfies it). */
export type ModelSwitchSession = Pick<ClientSession, 'providers'> &
  Pick<SessionLike, 'readyProviders' | 'credentialResolver'>;

const SEPARATOR = '::';

export function formatModelChoice(choice: ModelChoice): string {
  return `${choice.provider}${SEPARATOR}${choice.model}`;
}

/** Parse `provider::model`; anything else (missing half, blank) is null. */
export function parseModelChoice(raw: string | null | undefined): ModelChoice | null {
  if (typeof raw !== 'string') return null;
  const at = raw.indexOf(SEPARATOR);
  if (at < 0) return null;
  const provider = raw.slice(0, at).trim();
  const model = raw.slice(at + SEPARATOR.length).trim();
  return provider && model ? { provider, model } : null;
}

/**
 * Readiness is resolved at boot; without it (a session that never resolved
 * credentials) only the active provider is known to work — the same fallback
 * `Session.info()` reports.
 */
function isConnected(session: ModelSwitchSession, provider: string): boolean {
  const ready = session.readyProviders;
  return ready ? ready.has(provider) : session.providers.getActiveName() === provider;
}

export function listModelOptions(session: ModelSwitchSession): ModelOption[] {
  return session.providers.list().flatMap((def) =>
    def.models.map((m) => ({
      provider: def.name,
      model: m.id,
      connected: isConnected(session, def.name),
    })),
  );
}

/**
 * Resolve what the user typed: an exact `provider::model`, then an exact bare
 * model id, then a case-insensitive substring of `provider::model`.
 */
export function findModelOptions(options: ReadonlyArray<ModelOption>, query: string): ModelOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const key = (o: ModelOption) => formatModelChoice(o).toLowerCase();
  const exact = options.filter((o) => key(o) === q);
  if (exact.length > 0) return exact;
  const byModel = options.filter((o) => o.model.toLowerCase() === q);
  if (byModel.length > 0) return byModel;
  return options.filter((o) => key(o).includes(q));
}

function setupHint(provider: string): string {
  return provider === 'openai-codex'
    ? 'moxxy login openai-codex'
    : `moxxy init   # (will prompt for ${provider.toUpperCase()}_API_KEY)`;
}

/**
 * Make `choice.provider` the active provider (resolving its credentials and
 * dropping the cached client, exactly like the TUI picker). The model itself is
 * per-turn (`runTurn({ model })`), so the caller passes `choice.model` on.
 */
export async function applyModelChoice(
  session: ModelSwitchSession,
  choice: ModelChoice,
): Promise<ApplyModelResult> {
  const def = session.providers.list().find((p) => p.name === choice.provider);
  if (!def) {
    return { ok: false, reason: 'unknown-provider', message: `unknown provider: ${choice.provider}` };
  }
  if (session.providers.getActiveName() === choice.provider) return { ok: true };
  if (!isConnected(session, choice.provider)) {
    return {
      ok: false,
      reason: 'not-connected',
      message: `${choice.provider} isn't connected. Run \`${setupHint(choice.provider)}\` then restart the channel.`,
    };
  }
  const config = session.credentialResolver ? await session.credentialResolver(choice.provider) : {};
  session.providers.replace(def);
  session.providers.setActive(choice.provider, config);
  return { ok: true };
}
