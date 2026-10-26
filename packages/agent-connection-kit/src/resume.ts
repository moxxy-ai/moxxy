/** What became of loading an agent's earlier session. */
export type Resumed<T> = { readonly kind: 'loaded'; readonly session: T } | { readonly kind: 'gone' };

export interface ResumeOptions<T> {
  /** The agent's name as the person knows it ("OpenCode"). */
  readonly label: string;
  readonly load: () => Promise<T>;
  /** After a failed load: whether the agent says the session no longer exists. */
  readonly gone: (error: unknown) => boolean | Promise<boolean>;
  /** The pause before the one retry of a load that failed otherwise. */
  readonly retryAfterMs?: number;
}

const RETRY_AFTER_MS = 500;

/**
 * What the agent is told, with the person's next message, when its earlier
 * session no longer exists: it starts without that history and says so.
 */
export const LOST_SESSION_NOTE =
  'Moxxy could not find your earlier session for this conversation: it no longer exists, so you start this one without that history. Tell the person so in one sentence before anything else.';

/** Why an agent started a session of its own while the conversation already ran: its earlier one is gone, or it had none. */
export type NewSessionReason = 'lost' | 'new';

/**
 * What a new agent session is told first: the conversation so far from
 * Moxxy's record (`AgentStepRequest.earlierConversation`), so the agent
 * carries on instead of starting over. `undefined` when there is nothing to say.
 */
export function earlierConversationNote(reason: NewSessionReason, earlier: string | undefined): string | undefined {
  if (earlier === undefined) return reason === 'lost' ? LOST_SESSION_NOTE : undefined;
  const intro =
    reason === 'lost'
      ? 'Your earlier session for this Moxxy conversation no longer exists, so this one is new. Carry on from where the conversation is; there is no need to bring the change up.'
      : 'You join this Moxxy conversation partway: its earlier turns ran without you.';
  return `${intro}\n\n${earlier}`;
}

/**
 * Load the agent's earlier session for a conversation. A fresh session is
 * only ever the caller's answer to `gone`, the agent saying the session no
 * longer exists; any other failure is tried once more and then reported, so a
 * passing fault never quietly drops the conversation's history.
 */
export async function resumeAgentSession<T>(opts: ResumeOptions<T>): Promise<Resumed<T>> {
  try {
    return { kind: 'loaded', session: await opts.load() };
  } catch (first) {
    if (await opts.gone(first)) return { kind: 'gone' };
  }
  await new Promise((resolve) => setTimeout(resolve, opts.retryAfterMs ?? RETRY_AFTER_MS));
  try {
    return { kind: 'loaded', session: await opts.load() };
  } catch (second) {
    if (await opts.gone(second)) return { kind: 'gone' };
    const reason = second instanceof Error ? second.message : String(second);
    throw new Error(
      `${opts.label} could not load this conversation's earlier session (${reason}). Moxxy started no other session in its place, so that history is kept: send the message again to try once more.`,
      { cause: second },
    );
  }
}
