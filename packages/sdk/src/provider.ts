import type { ToolDef } from './tool.js';

export interface ProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool_result';
  readonly content: ReadonlyArray<ContentBlock>;
}

export type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly isError?: boolean }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string }
  | { readonly type: 'audio'; readonly mediaType: string; readonly data: string }
  /**
   * A document the model reads natively (e.g. a PDF). `data` is base64-encoded
   * bytes and `mediaType` the document MIME (e.g. `application/pdf`). Providers
   * that support documents translate it to their native shape (Anthropic
   * `document`, OpenAI `file`, Responses `input_file`); those that don't degrade
   * to a text placeholder. Text/Office files are inlined as `text` instead — only
   * formats a model ingests as bytes become `document` blocks.
   */
  | { readonly type: 'document'; readonly mediaType: string; readonly data: string; readonly name?: string }
  /**
   * A model reasoning/thinking block, preserved in conversation history so it
   * can be replayed on the next request. Anthropic REQUIRES the signed
   * `thinking` block be sent back (as the first block of an assistant turn that
   * also carries tool_use) on an interleaved-thinking continuation — a missing
   * or unsigned block is a hard 400, so the loop drops unsigned reasoning from
   * what it replays. `redacted` blocks carry only `encrypted` (the opaque blob)
   * and `text: ''`; they are replayed verbatim, never shown. Providers without
   * reasoning ignore this block.
   */
  | {
      readonly type: 'reasoning';
      readonly text: string;
      readonly signature?: string;
      readonly redacted?: boolean;
      readonly encrypted?: string;
    };

/**
 * Provider-neutral instruction for where a prompt-cache breakpoint should be
 * placed. A {@link CacheStrategyDef} emits these; providers that support
 * caching (e.g. Anthropic via `cache_control`) translate them into their
 * native marker, and providers that don't simply ignore them.
 *
 * `tools` / `system` mark the end of those (session-stable) regions;
 * `{ messageIndex }` marks the end of the message at that index in the
 * request's `messages` array (used for the rolling prefix breakpoint).
 * Anthropic honors at most 4 breakpoints per request.
 */
export interface CacheHint {
  readonly target: 'tools' | 'system' | { readonly messageIndex: number };
}

export interface ProviderRequest {
  readonly model: string;
  /**
   * Extra system text delivered IN ADDITION to any `role: 'system'`
   * messages in `messages`. The loop helpers project the composed system
   * prompt as the leading system message (so cache hints can target it)
   * and leave this unset; `onBeforeProviderCall` hooks use it as the
   * side channel for per-request system injections (e.g. plugin-memory's
   * consolidation nudge), and direct callers (e.g. skill synthesis) may
   * set it instead of crafting a system message. Providers MUST deliver
   * it — appended after the message-derived system text — never drop it.
   */
  readonly system?: string;
  readonly messages: ReadonlyArray<ProviderMessage>;
  readonly tools?: ReadonlyArray<ToolDef>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
  /** Where to place prompt-cache breakpoints. Set by the active CacheStrategy. */
  readonly cacheHints?: ReadonlyArray<CacheHint>;
  /**
   * Request reasoning/thinking from the model. `false`/absent = off. Providers
   * gate on this AND the model descriptor's `supportsReasoning`; unsupported
   * providers/models ignore it. The loop sets it from the active provider's
   * reasoning config (see the per-provider reasoning setting). `effort` maps to
   * each provider's native knob (Anthropic thinking budget, OpenAI/Codex
   * `reasoning.effort`).
   */
  readonly reasoning?: { readonly effort?: 'low' | 'medium' | 'high' } | boolean;
}

export type ProviderEvent =
  | { readonly type: 'message_start'; readonly model: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use_start'; readonly id: string; readonly name: string }
  | { readonly type: 'tool_use_delta'; readonly id: string; readonly partialInput: string }
  | { readonly type: 'tool_use_end'; readonly id: string; readonly input: unknown }
  | { readonly type: 'message_end'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error'; readonly usage?: TokenUsage }
  | { readonly type: 'error'; readonly message: string; readonly retryable: boolean }
  /** A streamed reasoning/thinking text delta (visible summary). */
  | { readonly type: 'reasoning_delta'; readonly delta: string }
  /**
   * End-of-reasoning-block metadata for history round-trip, emitted once per
   * reasoning block. `signature` is Anthropic's thinking-block signature;
   * `encrypted` carries an opaque blob (Anthropic redacted_thinking data /
   * Codex reasoning encrypted_content) that must be replayed verbatim;
   * `redacted` marks reasoning that must never be displayed.
   */
  | { readonly type: 'reasoning_signature'; readonly signature?: string; readonly redacted?: boolean; readonly encrypted?: string };

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  /**
   * Whether this model accepts `image` ContentBlocks in user messages.
   * Channels gate image attachments on this flag — if a user drops an
   * image while a non-vision model is active, the channel either
   * refuses or warns instead of silently dropping the bytes.
   */
  readonly supportsImages?: boolean;
  /**
   * Whether this model accepts `document` ContentBlocks (e.g. native PDF) in
   * user messages. When false, the desktop reader extracts text instead of
   * shipping the raw bytes, so the attachment still reaches the model — just
   * without full-document fidelity (figures/layout).
   */
  readonly supportsDocuments?: boolean;
  /**
   * Whether this model accepts `audio` ContentBlocks in user messages
   * (GPT-4o, Gemini-Live-class models). When false, channels with audio
   * input route through the session's active `Transcriber` and forward
   * the transcript as text instead.
   */
  readonly supportsAudio?: boolean;
  /**
   * Whether this model can emit reasoning/thinking summaries (Anthropic
   * extended thinking, OpenAI o-series / Codex reasoning). Gates the
   * per-provider reasoning config UI and whether the loop requests reasoning
   * for this model. When false, `ProviderRequest.reasoning` is ignored.
   */
  readonly supportsReasoning?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
  countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number>;
}

export type ProviderKeyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Minimal vault interface exposed to provider auth flows. Implementations
 * (typically `@moxxy/plugin-vault`) supply encrypted storage; the auth
 * descriptor doesn't need anything richer, so we keep the contract small
 * and SDK-Node-free.
 */
export interface ProviderVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, tags?: ReadonlyArray<string>): Promise<void>;
  delete?(key: string): Promise<boolean>;
}

/**
 * Runtime supplied to a provider's OAuth `login(ctx)` callback. The host
 * (e.g. `moxxy init`, `moxxy login <provider>`) constructs this and hands
 * it off; the provider plugin runs the flow end-to-end and persists
 * credentials via `ctx.vault`.
 */
export interface ProviderAuthContext {
  readonly vault: ProviderVault;
  /**
   * True when there is no usable browser or interactive TTY. OAuth flows
   * should fall back to device-code (or equivalent) in this mode rather
   * than spawning a local callback server / opening a browser.
   */
  readonly headless: boolean;
  /**
   * Progress-message sink. The host wires this to its preferred renderer
   * (clack `log.*`, plain stdout, …) so providers don't have to know
   * whether they're running inside a wizard or a one-shot command.
   */
  readonly write: (chunk: string) => void;
  /**
   * Optional single-line input prompt. Present when the host has an
   * interactive TTY; absent in headless runs. Flows that need the user to
   * paste something back — out-of-band / manual authorization-code flows,
   * or an existing-token paste — call this; flows that capture the code via
   * a loopback server (e.g. openai-codex) ignore it. Pass `{ mask: true }`
   * for secrets so the host can hide the echoed characters.
   */
  readonly prompt?: (question: string, opts?: { readonly mask?: boolean }) => Promise<string>;
}

export interface ProviderOAuthResult {
  /** Human-readable account identifier shown in the success message. */
  readonly accountId?: string | null;
  /** UNIX-ms expiry of the persisted credential; surfaced to users. */
  readonly expiresAt?: number;
}

/**
 * Self-describing auth metadata a provider plugin attaches to its
 * `ProviderDef`. Lets the CLI's setup wizard and `moxxy login` operate
 * generically over any installed provider — no CLI-side branch table.
 *
 * `apiKey`  : the host prompts for a key and calls `validateKey` (if any).
 * `oauth`   : the host hands the provider a `ProviderAuthContext`; the
 *             provider drives the full OAuth dance, including any local
 *             callback server, and persists tokens to `ctx.vault`.
 */
export type ProviderAuthDescriptor =
  | {
      readonly kind: 'apiKey';
      /** Canonical env-var name (e.g. `ANTHROPIC_API_KEY`). Inferred when omitted. */
      readonly envVar?: string;
      /** Short hint shown next to the prompt (e.g. "starts with `sk-ant-`"). */
      readonly hint?: string;
    }
  | {
      readonly kind: 'oauth';
      /** Human-readable name of the upstream service (e.g. "ChatGPT Pro/Plus"). */
      readonly serviceName?: string;
      /**
       * Drive the OAuth flow and persist credentials. Throws on failure /
       * user cancellation; the host typically offers a retry prompt.
       */
      login(ctx: ProviderAuthContext): Promise<ProviderOAuthResult>;
      /**
       * Optional logout — remove persisted credentials from the vault.
       * Returns true if anything was removed, false if there was nothing
       * stored. Used by `moxxy login logout <provider>`.
       */
      logout?(ctx: ProviderAuthContext): Promise<boolean>;
      /**
       * Optional status probe — returns a brief description of the stored
       * credential, or null if none. Used by `moxxy login status`.
       */
      status?(ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null>;
    };

export interface ProviderOAuthStatus {
  readonly accountId?: string | null;
  readonly expiresAt?: number;
  /** Vault key the credentials are stored under (informational). */
  readonly vaultKey?: string;
}

export interface ProviderDef {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  createClient(config: Record<string, unknown>): LLMProvider;
  /**
   * Optional check that the given key is actually accepted by the vendor.
   * Implementations should be cheap (a free metadata call or a 1-token
   * completion). Used by `moxxy init` to verify keys before persisting.
   */
  validateKey?(apiKey: string): Promise<ProviderKeyValidation>;
  /**
   * Optional auth descriptor. When omitted, the host treats the provider
   * as `{ kind: 'apiKey' }` — i.e. prompt for a key, call `validateKey`
   * if defined, store under the canonical vault entry.
   */
  readonly auth?: ProviderAuthDescriptor;
}
