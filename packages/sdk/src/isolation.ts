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
}

export interface IsolatedToolCall {
  readonly toolName: string;
  readonly input: unknown;
  readonly callId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly cwd: string;
}

/**
 * Pluggable runtime for executing tools under a capability spec.
 *
 * Phase 1 ships `none` (passthrough) and `inproc` (in-process with cap
 * validation + timeout). Phase 2+ adds `worker`, `subprocess`, `wasm`,
 * `docker` — they implement this same interface, no SDK change required.
 *
 * The isolator receives the handler already bound to its `ToolContext`,
 * so it only needs to marshal `(input) => output` across whatever
 * boundary it owns. Callers (the security plugin's hook) build the
 * bound handler from `tool.handler` + the in-process ctx.
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
