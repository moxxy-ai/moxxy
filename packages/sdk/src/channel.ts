import type { PermissionResolver } from './permission.js';

/**
 * A Channel is a bidirectional surface that drives a Session: it feeds user
 * prompts in, renders assistant chunks + tool activity out, and implements a
 * PermissionResolver so it can interrupt tool execution to ask the user.
 *
 * The TUI (Ink) and Telegram are both Channels. Future Slack / Discord / HTTP
 * channels implement this same interface so the moxxy CLI binary (or any
 * embedded consumer) can dispatch to them uniformly.
 *
 * Channels are NOT auto-loaded like other plugins — the consumer explicitly
 * picks one (e.g. `moxxy tui` or `moxxy telegram`). Channels are typically the
 * top-level process, owning the Session and running until SIGINT.
 *
 * The generic `TStartOpts` is the concrete options shape a given channel
 * accepts. We keep it opaque here because Session itself lives in @moxxy/core;
 * each channel implementation declares its own StartOpts type that includes a
 * session reference.
 */
export interface Channel<TStartOpts = unknown> {
  /** Stable name (lowercase, single word). Used by dispatchers to look up by string. */
  readonly name: string;

  /** The PermissionResolver this channel installs on the session. */
  readonly permissionResolver: PermissionResolver;

  /**
   * Begin running the channel. Returns a handle whose `running` promise
   * resolves when the channel exits gracefully.
   */
  start(opts: TStartOpts): Promise<ChannelHandle>;
}

export interface ChannelHandle {
  /**
   * Resolves when the channel exits cleanly (user quit, SIGINT caught,
   * upstream disconnected). Rejects on fatal error.
   */
  readonly running: Promise<void>;

  /** Request graceful shutdown. Implementations should abort any in-flight work. */
  stop(reason?: string): Promise<void>;
}

/** Common base shape for channel start options. */
export interface ChannelStartOptsBase {
  readonly model?: string;
  readonly systemPrompt?: string;
}
