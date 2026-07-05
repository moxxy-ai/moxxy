/**
 * The failure modes {@link fetchModelAsset} / {@link extractTarBz2} raise. A
 * dedicated error (rather than @moxxy/sdk's `MoxxyError`) keeps this package
 * free of internal deps and lets callers switch on a precise `code` — the
 * MoxxyError code union has no integrity/traversal member to borrow. Plugins
 * re-wrap these into a user-facing `MoxxyError` at their boundary when needed.
 */
export type ModelFetchErrorCode =
  /** The url is not `https:` on an allow-listed host (SSRF / local-file guard). */
  | 'HOST_DENIED'
  /** The download completed but its sha256 didn't match the pinned value. */
  | 'INTEGRITY_MISMATCH'
  /** The server body exceeded `maxBytes` (declared or streamed). */
  | 'TOO_LARGE'
  /** A tar entry tried to escape the destination (absolute / `..` / symlink). */
  | 'UNSAFE_ENTRY'
  /** A non-2xx HTTP response, or a body-less response. */
  | 'HTTP_ERROR'
  /** The caller's `signal` aborted the operation. */
  | 'ABORTED'
  /** Malformed archive / underlying IO failure surfaced during extraction. */
  | 'EXTRACT_FAILED';

export class ModelFetchError extends Error {
  readonly code: ModelFetchErrorCode;
  /** Structured, log-safe context (url host, expected/actual hash, …). */
  readonly context?: Readonly<Record<string, string | number>>;

  constructor(
    code: ModelFetchErrorCode,
    message: string,
    context?: Readonly<Record<string, string | number>>,
  ) {
    super(message);
    this.name = 'ModelFetchError';
    this.code = code;
    if (context) this.context = context;
  }
}
