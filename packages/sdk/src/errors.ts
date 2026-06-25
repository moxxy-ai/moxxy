/**
 * Structured error type used across moxxy. Anything that bubbles to the
 * user (CLI top-level, channel renderers) should throw a `MoxxyError`
 * with a stable `code`, an actionable `message`, and ideally a `hint` for
 * recovery. The CLI's bin.ts top-level handler formats these as:
 *
 *   error [CODE]  <message>
 *   hint: <hint>
 *
 * For raw / unknown errors that aren't ours (e.g. a Node `fetch` rejection
 * for ECONNREFUSED), call `classifyNetworkError(err, { url })` at the
 * fetch boundary to wrap them — that's where "fetch failed" turns into
 * `NETWORK_UNREACHABLE` + a useful message.
 */

/**
 * Stable error codes. Keep this set small and behavioural ("what does the
 * user need to do?") rather than exhaustively granular. New codes should
 * earn their place by mapping to a different recovery action than any
 * existing one.
 */
export type MoxxyErrorCode =
  // --- Network ---
  | 'NETWORK_UNREACHABLE'       // DNS failed / connection refused / no route
  | 'NETWORK_TIMEOUT'           // request timed out
  | 'NETWORK_TLS_FAILURE'       // bad cert, self-signed, etc.
  | 'NETWORK_ABORTED'           // user/signal aborted the request
  // --- Auth ---
  | 'AUTH_NO_CREDENTIALS'       // no API key / OAuth token stored
  | 'AUTH_EXPIRED'              // token expired and refresh failed
  | 'AUTH_INVALID'              // 401 — credentials rejected by provider
  | 'AUTH_DENIED'               // 403 — credentials lack permission
  // --- OAuth flow ---
  | 'OAUTH_FLOW_TIMEOUT'        // user didn't complete in time
  | 'OAUTH_FLOW_DENIED'         // user clicked deny
  | 'OAUTH_FLOW_STATE_MISMATCH' // CSRF guard tripped
  | 'OAUTH_FLOW_PORT_BUSY'      // EADDRINUSE on callback server
  | 'OAUTH_FLOW_NOT_SUPPORTED'  // provider doesn't expose this flow
  // --- Provider ---
  | 'PROVIDER_NOT_CONFIGURED'   // no active provider, no key
  | 'PROVIDER_RATE_LIMITED'     // 429
  | 'PROVIDER_SERVER_ERROR'     // 5xx
  | 'PROVIDER_BAD_REQUEST'      // 400 with provider-shaped message
  | 'PROVIDER_UNKNOWN_RESPONSE' // 2xx but couldn't parse
  // --- Vault ---
  | 'VAULT_PASSPHRASE'          // wrong passphrase
  | 'VAULT_CORRUPT'             // file unreadable / malformed
  // --- Config / setup ---
  | 'CONFIG_INVALID'
  | 'PLUGIN_LOAD_FAILED'
  | 'PLUGIN_PROTECTED'          // a kernel/critical package can't be disabled — swap its default instead
  | 'UNKNOWN_COMMAND'
  // --- Tool / runtime ---
  | 'TOOL_ERROR'               // a tool handler failed (bad input, not-found, exec error)
  | 'ABORTED'                  // operation cancelled — turn abort signal or timeout kill
  // --- Catch-all ---
  | 'INTERNAL';

export interface MoxxyErrorInit {
  readonly code: MoxxyErrorCode;
  readonly message: string;
  readonly hint?: string;
  /**
   * Stable structured context — surfaced to logs / debug output, NOT in
   * the default user-facing message. Use for `provider`, `url`, `status`,
   * `provider_id`, etc.
   */
  readonly context?: Readonly<Record<string, string | number>>;
  /** Underlying error, for chained-cause stack traces. */
  readonly cause?: unknown;
}

/**
 * Tagged error class. Use the constructor directly for fresh errors, or
 * `MoxxyError.wrap` to upgrade an unknown thrown value while preserving
 * the original cause. The CLI's top-level handler keys off `instanceof
 * MoxxyError` to render the structured form.
 */
export class MoxxyError extends Error {
  readonly code: MoxxyErrorCode;
  readonly hint?: string;
  readonly context?: Readonly<Record<string, string | number>>;

  constructor(init: MoxxyErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'MoxxyError';
    this.code = init.code;
    if (init.hint !== undefined) this.hint = init.hint;
    if (init.context !== undefined) this.context = init.context;
  }

  static isMoxxyError(err: unknown): err is MoxxyError {
    // `instanceof` works in-process; the name check rescues cases where
    // the error crosses a module-realm boundary (rare but possible with
    // dynamic imports through different SDK copies).
    return err instanceof MoxxyError || (err instanceof Error && err.name === 'MoxxyError');
  }

  /**
   * Convert an unknown thrown value to a MoxxyError. If `err` is already
   * one, returns it unchanged. Otherwise builds a new error with the
   * given code/message/hint and attaches `err` as `cause`.
   */
  static wrap(err: unknown, init: Omit<MoxxyErrorInit, 'cause'>): MoxxyError {
    if (MoxxyError.isMoxxyError(err)) return err;
    return new MoxxyError({ ...init, cause: err });
  }
}

/**
 * Inspect a thrown value for Node networking signals and produce a
 * MoxxyError when one matches. Returns `null` when the error doesn't
 * look network-shaped — callers should fall through to other handlers
 * (e.g. status-code mapping).
 *
 * Node's `fetch` (undici) hides the real reason inside `err.cause.code`
 * (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, CERT_HAS_EXPIRED, ...). Without
 * unwrapping that we'd surface only "fetch failed" / "TypeError: failed
 * to fetch", which is what triggered this whole error-rename effort.
 */
export function classifyNetworkError(
  err: unknown,
  ctx: { readonly url?: string; readonly provider?: string } = {},
): MoxxyError | null {
  if (MoxxyError.isMoxxyError(err)) return err;
  if (!(err instanceof Error)) return null;

  const code = extractNodeErrorCode(err);
  const url = ctx.url;
  const target = url ? hostOf(url) : (ctx.provider ?? 'the upstream service');
  const baseContext: Record<string, string> = {};
  if (url) baseContext.url = url;
  if (ctx.provider) baseContext.provider = ctx.provider;

  // Abort first — distinct UX from a real failure.
  if (
    err.name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    code === 'ERR_ABORTED'
  ) {
    return new MoxxyError({
      code: 'NETWORK_ABORTED',
      message: `Request to ${target} was aborted.`,
      context: baseContext,
      cause: err,
    });
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: `DNS lookup failed for ${target}.`,
      hint:
        'Check your internet connection. If you\'re on a corporate network, ' +
        'a DNS-blocking proxy may be in the way — set HTTPS_PROXY or try a different network.',
      context: baseContext,
      cause: err,
    });
  }
  if (code === 'ECONNREFUSED') {
    return new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: `Connection refused by ${target}.`,
      hint:
        'The host actively rejected the connection. If you\'re targeting a local ' +
        'server, make sure it\'s running and listening on the expected port.',
      context: baseContext,
      cause: err,
    });
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: `No route to ${target}.`,
      hint: 'Check your internet connection or VPN.',
      context: baseContext,
      cause: err,
    });
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new MoxxyError({
      code: 'NETWORK_TIMEOUT',
      message: `Request to ${target} timed out.`,
      hint:
        'The host accepted the connection but didn\'t respond in time. Retry, ' +
        'or check whether the service is experiencing an outage.',
      context: baseContext,
      cause: err,
    });
  }
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    (typeof code === 'string' && code.startsWith('ERR_TLS'))
  ) {
    return new MoxxyError({
      code: 'NETWORK_TLS_FAILURE',
      message: `TLS handshake with ${target} failed (${code}).`,
      hint:
        'The server\'s certificate couldn\'t be verified. This usually means a ' +
        'self-signed cert or an MITM proxy on your network.',
      context: baseContext,
      cause: err,
    });
  }
  if (code === 'ECONNRESET') {
    return new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: `Connection to ${target} was reset.`,
      hint: 'The server dropped the connection mid-request. Retry, or check the service status.',
      context: baseContext,
      cause: err,
    });
  }

  // Last-chance heuristics on the message text. Node fetch's outer
  // message is just "fetch failed"; the useful signal is in `cause`, but
  // some libraries flatten that.
  const msg = err.message.toLowerCase();
  if (msg === 'fetch failed' || msg.includes('failed to fetch')) {
    return new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: `Couldn't reach ${target}.`,
      hint: 'Check your internet connection or any proxy/firewall settings.',
      context: baseContext,
      cause: err,
    });
  }

  return null;
}

/**
 * Walk `err.cause` chain looking for a Node-style `code` (e.g. on
 * `SystemError`, `DOMException`, undici's `UND_*` codes). Node nests the
 * real reason under `cause` for fetch errors.
 */
function extractNodeErrorCode(err: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; cause?: unknown; name?: unknown };
  if (typeof e.code === 'string' && e.code.length > 0) return e.code;
  if (e.cause) return extractNodeErrorCode(e.cause, depth + 1);
  return undefined;
}

/**
 * Build a MoxxyError from an HTTP response that came back with a 4xx/5xx.
 * Maps common status codes to auth / rate-limit / server-error codes.
 * Pass the response body text in `body` so the message can echo the
 * provider's reason. Returns `null` for unmapped status codes (caller
 * should fall back to a generic error).
 */
export function classifyHttpStatus(
  status: number,
  ctx: { readonly url?: string; readonly provider?: string; readonly body?: string } = {},
): MoxxyError | null {
  const target = ctx.provider ?? (ctx.url ? hostOf(ctx.url) : 'the upstream service');
  const tail = ctx.body ? ` — ${truncate(ctx.body, 200)}` : '';
  const context: Record<string, string | number> = { status };
  if (ctx.url) context.url = ctx.url;
  if (ctx.provider) context.provider = ctx.provider;

  if (status === 401) {
    return new MoxxyError({
      code: 'AUTH_INVALID',
      message: `${target} rejected the credentials (401).${tail}`,
      hint:
        `Run \`moxxy login ${ctx.provider ?? '<provider>'}\` (OAuth) or check your API key.`,
      context,
    });
  }
  if (status === 403) {
    return new MoxxyError({
      code: 'AUTH_DENIED',
      message: `${target} denied the request (403).${tail}`,
      hint: 'Your credentials are valid but lack permission for this resource.',
      context,
    });
  }
  if (status === 429) {
    return new MoxxyError({
      code: 'PROVIDER_RATE_LIMITED',
      message: `${target} is rate-limiting requests (429).${tail}`,
      hint: 'Back off and retry. Check your plan limits if this keeps happening.',
      context,
    });
  }
  if (status >= 500 && status < 600) {
    return new MoxxyError({
      code: 'PROVIDER_SERVER_ERROR',
      message: `${target} returned a server error (${status}).${tail}`,
      hint: 'This is on the provider\'s side. Retry, or check their status page.',
      context,
    });
  }
  if (status === 400) {
    return new MoxxyError({
      code: 'PROVIDER_BAD_REQUEST',
      message: `${target} rejected the request as malformed (400).${tail}`,
      context,
    });
  }
  return null;
}

/**
 * Extract a URL's host for display. `url` is caller-supplied (provider base
 * URLs, OAuth token URLs) and may be malformed/relative — `new URL()` would
 * throw `ERR_INVALID_URL` from inside the error classifier, masking the real
 * failure the caller is trying to report. Degrade gracefully to the raw string
 * instead of throwing while classifying an error.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
