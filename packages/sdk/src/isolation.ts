/**
 * Filesystem capability declaration. Each entry is a glob; the special
 * `$cwd` prefix resolves to `ToolContext.cwd` at call time, so a tool
 * can declare "I only touch my own cwd" without hard-coding a path.
 * Patterns are matched against absolute, normalized paths.
 */
export interface FsCapability {
  readonly read?: ReadonlyArray<string>;
  readonly write?: ReadonlyArray<string>;
}

export type NetCapability =
  | { readonly mode: 'none' }
  | { readonly mode: 'any' }
  | { readonly mode: 'allowlist'; readonly hosts: ReadonlyArray<string> };

/**
 * Declarative capability surface a tool requires. Plugin authors set
 * this on `defineTool({ ..., isolation: { capabilities: {...} } })`.
 *
 * Treated as advisory until the user enables `@moxxy/plugin-security`.
 * Once enabled, the active Isolator enforces these bounds at call time.
 */
export interface CapabilitySpec {
  readonly fs?: FsCapability;
  readonly net?: NetCapability;
  readonly env?: ReadonlyArray<string>;
  /** Wall-clock budget in milliseconds. Aborted via ctx.signal on overrun. */
  readonly timeMs?: number;
  /** Soft memory ceiling in MB. Honored only by isolators that support it. */
  readonly memMb?: number;
  /** Whether the tool may spawn child processes. Defaults to false. */
  readonly subprocess?: boolean;
}

export type IsolationStrength =
  | 'none'
  | 'inproc'
  | 'worker'
  | 'subprocess'
  | 'vm'
  | 'wasm'
  | 'docker';

export interface ToolIsolationSpec {
  /**
   * Minimum isolator strength the tool author considers acceptable. If the
   * user's configured isolator is weaker, the security plugin denies the
   * call rather than silently running with insufficient isolation.
   */
  readonly required?: IsolationStrength;
  readonly capabilities: CapabilitySpec;
  /**
   * Module + export reference to the handler. Required for tools that
   * want to be runnable under out-of-process isolators (`worker`,
   * `subprocess`, …). When omitted, the tool is only executable under
   * `none` / `inproc`; stronger isolators will deny.
   *
   * Convention: derive `url` from `import.meta.url` at `defineTool(...)` time:
   * ```
   * handlerModule: {
   *   url: new URL('./read-handler.js', import.meta.url).href,
   *   export: 'readHandler',
   * }
   * ```
   * — that keeps the pointer correct after the package is published.
   */
  readonly handlerModule?: HandlerModuleRef;
}

/**
 * Pointer to a tool's handler as a *module + export*. When present on
 * `ToolDef.handlerModule`, stronger isolators (worker, subprocess, wasm)
 * re-import that module on their side of the boundary and call the
 * named export — closures aren't serializable across thread/process
 * boundaries, so this declarative form is the only way to actually
 * re-execute a handler outside the main process.
 *
 * `url` should be an absolute `file://` URL or import-resolvable path.
 * The conventional shape is `new URL('./handler-module.js', import.meta.url).href`
 * at `defineTool(...)` time, so the reference resolves correctly regardless
 * of where the published package ends up on the consumer's disk.
 */
export interface HandlerModuleRef {
  /** Module URL (typically `file://...`) the isolator can `import()`. */
  readonly url: string;
  /** Named export of the handler within that module. */
  readonly export: string;
}

export interface IsolatedToolCall {
  readonly toolName: string;
  readonly input: unknown;
  readonly callId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly cwd: string;
  /**
   * Set by the security plugin when the tool declared `handlerModule`.
   * Isolators that re-execute the handler off-thread (worker/subprocess/…)
   * read this; in-process isolators (`none`, `inproc`) ignore it because
   * they invoke the bound closure directly.
   */
  readonly moduleRef?: HandlerModuleRef;
}

/**
 * Pluggable runtime for executing tools under a capability spec.
 *
 * The isolator receives:
 * - `call.input` — the validated tool input.
 * - `handler` — an in-process closure bound to the real `ToolContext`.
 *   In-process isolators (`none`, `inproc`) invoke this directly.
 * - `call.moduleRef` — optional reference to the handler's source
 *   module. Out-of-process isolators (`worker`, `subprocess`, `wasm`)
 *   `import()` this on their side of the boundary and call the named
 *   export, because closures don't cross thread/process boundaries.
 *   An out-of-process isolator that receives a call with no `moduleRef`
 *   should deny: it has no way to actually run the handler in isolation.
 */
export interface Isolator {
  readonly name: string;
  readonly strength: IsolationStrength;
  run(
    call: IsolatedToolCall,
    handler: (input: unknown) => Promise<unknown>,
    caps: CapabilitySpec,
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** Numerical ordering of isolation strengths. Higher = stricter. */
export const ISOLATION_RANK: Readonly<Record<IsolationStrength, number>> = Object.freeze({
  none: 0,
  inproc: 1,
  worker: 2,
  subprocess: 3,
  vm: 4,
  wasm: 5,
  docker: 6,
});
