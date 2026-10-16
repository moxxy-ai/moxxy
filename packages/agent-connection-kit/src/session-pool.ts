import { waitFor } from '@moxxy/sdk';

/** A running vendor agent session (a process, a thread on an app-server). */
export interface LiveSession {
  close(): void | Promise<void>;
}

export interface AgentSessionPoolOptions<T extends LiveSession> {
  /** How many agents may run at once across conversations. */
  readonly limit: number;
  /** How to start an agent, unless `acquire` is given its own way. */
  readonly create?: (conversation: string) => Promise<T>;
}

export interface AcquireOptions<T extends LiveSession> {
  readonly signal?: AbortSignal;
  /** Start the agent with this turn's settings (model, resume id, …). */
  readonly create?: (conversation: string) => Promise<T>;
}

/** One turn's hold on a conversation's agent. */
export interface AgentSessionLease<T extends LiveSession> {
  readonly session: T;
  /** The turn is over; the agent stays running for the next one. */
  release(): void;
  /** The agent is broken or out of date: close it; the next turn starts a new one. */
  discard(): Promise<void>;
}

interface Entry<T> {
  session: T | undefined;
  busy: boolean;
  lastUsed: number;
}

type Take<T> = { readonly kind: 'ready'; readonly entry: Entry<T> } | { readonly kind: 'start'; readonly entry: Entry<T> };

/**
 * One live agent per conversation, up to a limit. When the limit is reached
 * the agent used longest ago is closed; when every agent is in a turn, the
 * next conversation waits until a turn ends (woken by it, never by a timer).
 */
export class AgentSessionPool<T extends LiveSession> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly listeners = new Set<() => void>();
  private clock = 0;
  private closed = false;

  constructor(private readonly opts: AgentSessionPoolOptions<T>) {}

  get size(): number {
    return this.entries.size;
  }

  async acquire(conversation: string, opts: AcquireOptions<T> = {}): Promise<AgentSessionLease<T>> {
    const create = opts.create ?? this.opts.create;
    if (!create) throw new Error('No way to start an agent session was given.');
    const outcome = await waitFor(() => this.take(conversation), {
      wakeOn: [(wake) => this.subscribe(wake)],
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (outcome.status !== 'ready') throw abortError();
    const taken = outcome.value;
    if (taken.kind === 'start') {
      try {
        taken.entry.session = await create(conversation);
      } catch (err) {
        this.entries.delete(conversation);
        this.changed();
        throw err;
      }
    }
    return this.lease(conversation, taken.entry);
  }

  /** The conversation ended: close its agent, even mid-turn. */
  async close(conversation: string): Promise<void> {
    const entry = this.entries.get(conversation);
    if (!entry) return;
    this.entries.delete(conversation);
    this.changed();
    await entry.session?.close();
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const sessions = [...this.entries.values()].map((entry) => entry.session);
    this.entries.clear();
    this.changed();
    await Promise.all(sessions.map((session) => session?.close()));
  }

  /** Take the conversation's agent, or a place to start one; `undefined` means wait. */
  private take(conversation: string): Take<T> | undefined {
    if (this.closed) throw new Error('The agent sessions are closed.');
    const existing = this.entries.get(conversation);
    if (existing) {
      if (existing.busy) return undefined;
      existing.busy = true;
      existing.lastUsed = ++this.clock;
      return { kind: 'ready', entry: existing };
    }
    if (this.entries.size >= this.opts.limit && !this.evictIdlest()) return undefined;
    const entry: Entry<T> = { session: undefined, busy: true, lastUsed: ++this.clock };
    this.entries.set(conversation, entry);
    return { kind: 'start', entry };
  }

  private evictIdlest(): boolean {
    let idlest: [string, Entry<T>] | undefined;
    for (const pair of this.entries) {
      if (pair[1].busy) continue;
      if (!idlest || pair[1].lastUsed < idlest[1].lastUsed) idlest = pair;
    }
    if (!idlest) return false;
    this.entries.delete(idlest[0]);
    void idlest[1].session?.close();
    return true;
  }

  private lease(conversation: string, entry: Entry<T>): AgentSessionLease<T> {
    const { session } = entry;
    if (session === undefined) throw new Error('An agent session was leased before it started.');
    let done = false;
    return {
      session,
      release: () => {
        if (done) return;
        done = true;
        entry.busy = false;
        entry.lastUsed = ++this.clock;
        this.changed();
      },
      discard: async () => {
        if (done) return;
        done = true;
        if (this.entries.get(conversation) === entry) this.entries.delete(conversation);
        this.changed();
        await session.close();
      },
    };
  }

  private subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function abortError(): Error {
  const error = new Error('Waiting for an agent session was aborted.');
  error.name = 'AbortError';
  return error;
}
