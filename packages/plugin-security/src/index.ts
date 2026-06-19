import {
  definePlugin,
  ISOLATION_RANK,
  type IsolatedToolCall,
  type Isolator,
  type LifecycleHooks,
  type Plugin,
  type ToolDef,
  type ToolContext,
} from '@moxxy/sdk';
import { IsolatorRegistry } from './registry.js';
import { checkAllCaps } from './cap-check.js';

/**
 * Isolator strengths that run the handler IN the host process. For these the
 * only enforcement we have is the input cap-check; an out-of-process isolator
 * enforces at the boundary instead, so `onToolCall` must not second-guess it
 * with a host-side cap-check it never declared.
 */
const IN_PROCESS_STRENGTHS: ReadonlySet<string> = new Set(['none', 'inproc']);

/**
 * Mutable view of the tool registry. Matches the surface that
 * `ToolRegistryImpl` in @moxxy/core exposes; declared locally so the
 * plugin doesn't take a runtime dep on core (mirrors the same pattern
 * @moxxy/plugin-mcp uses for `AdminToolRegistryLike`).
 */
export interface SecurityToolRegistryLike {
  list(): ReadonlyArray<ToolDef>;
  get(name: string): ToolDef | undefined;
  has(name: string): boolean;
  register(tool: ToolDef): void;
  unregister(name: string): void;
}

export { noneIsolator } from './isolators/none.js';
export { inprocIsolator } from './isolators/inproc.js';
export { IsolatorRegistry } from './registry.js';
export {
  checkAllCaps,
  checkFsCap,
  checkNetCap,
  pathInScope,
  urlInScope,
  maskEnv,
  expandHomeAndCwd,
  type CapCheckResult,
  type CapCheckOptions,
} from './cap-check.js';
export {
  handleBrokerRequest,
  buildBrokerEnv,
  BLOCKED_HANDLER_MODULES,
  LOADER_HOOK_SOURCE,
  type BrokerOp,
  type BrokerRequest,
  type BrokerResponse,
  type BrokerContext,
} from './broker.js';
export { BROKER_CLIENT_SOURCE, SYNTHETIC_CTX_SOURCE } from './shim.js';
export { BrokerOpLimiter, DEFAULT_MAX_INFLIGHT_BROKER_OPS } from './broker-limiter.js';

/**
 * Runtime config shape consumed by `buildSecurityPlugin`. Mirrors the
 * Zod schema in `@moxxy/config` (`security: { ... }`) but lives here so
 * the plugin has no runtime dep on the config package.
 */
export interface SecurityPluginConfig {
  readonly enabled: boolean;
  readonly isolator?: string;
  readonly perTool?: Readonly<Record<string, string>>;
  readonly perPlugin?: Readonly<Record<string, string>>;
  readonly requireDeclaration?: boolean;
  /**
   * Tighten the in-process input cap-check from best-effort to fail-closed.
   *
   * By DEFAULT the fs/net checks only inspect string values under a recognized
   * key name (`file`, `path`, `url`, …); a path or URL carried by an
   * unrecognized field (`config`, `manifest`, `callback`, `webhook`) is NOT
   * checked, so the call is allowed even though the handler may then do
   * out-of-scope fs/net. This is a documented best-effort heuristic, not a
   * guarantee — an out-of-process isolator (worker/subprocess/wasm) is what
   * actually enforces caps at a boundary.
   *
   * With `strict: true`, the cap-check ALSO treats any string value that is
   * unambiguously an absolute path or a bare `http(s)` URL as in-scope-required
   * regardless of key name, so an unrecognized carrier fails closed. The shape
   * test stays tight (single token, no whitespace) so prose strings are not
   * mis-flagged.
   */
  readonly strict?: boolean;
}

export interface BuildSecurityPluginOptions {
  readonly config: SecurityPluginConfig;
  /** Tool registry; tools with `isolation` get wrapped in `onInit`. */
  readonly toolRegistry: SecurityToolRegistryLike;
  /** Extra isolators on top of the built-in `none` + `inproc`. */
  readonly isolators?: ReadonlyArray<Isolator>;
  /**
   * Resolves `tool name → contributing plugin name` for `perPlugin`
   * overrides. Pass `null` to disable plugin-level routing entirely.
   */
  readonly resolvePluginForTool?: ((toolName: string) => string | undefined) | null;
}

export interface SecurityPluginHandle {
  readonly plugin: Plugin;
  readonly registry: IsolatorRegistry;
  /** Auditable view of every known tool's isolation state. */
  audit(): ReadonlyArray<AuditEntry>;
}

export interface AuditEntry {
  readonly tool: string;
  readonly declared: boolean;
  readonly required?: string;
  readonly resolvedIsolator: string;
  readonly capabilities?: Readonly<Record<string, unknown>>;
  /** True when the tool declared a `handlerModule` and can therefore run
   *  under out-of-process isolators. */
  readonly hasModuleRef: boolean;
}

const DEFAULT_ISOLATOR = 'inproc';

export function buildSecurityPlugin(opts: BuildSecurityPluginOptions): SecurityPluginHandle {
  const registry = new IsolatorRegistry(opts.isolators);
  const cfg = opts.config;
  const tools = opts.toolRegistry;

  const resolvePluginForTool =
    opts.resolvePluginForTool === null ? null : opts.resolvePluginForTool;

  const pickIsolatorName = (toolName: string): string => {
    if (cfg.perTool?.[toolName]) return cfg.perTool[toolName]!;
    const plug =
      resolvePluginForTool === null ? undefined : resolvePluginForTool?.(toolName);
    if (plug && cfg.perPlugin?.[plug]) return cfg.perPlugin[plug]!;
    return cfg.isolator ?? DEFAULT_ISOLATOR;
  };

  /**
   * Wrap every tool that declared an `isolation` spec so its handler
   * runs through the configured isolator. Tools without a declaration
   * are left untouched.
   *
   * Idempotent: an already-wrapped tool carries a non-enumerable
   * `__moxxySecurityWrapped` marker (see {@link isSecurityWrapped}) and is
   * skipped on subsequent passes. Without this guard a second `onInit` (e.g.
   * after a hot plugin reload) would re-wrap each tool — nesting `iso.run()`
   * inside `iso.run()` and doubling cap-checks/timeouts/handler invocations.
   */
  const wrapDeclaredTools = (): void => {
    if (!cfg.enabled) return;
    for (const t of tools.list()) {
      if (!t.isolation) continue;
      if (isSecurityWrapped(t)) continue;
      const wrapped = wrapWithIsolator(t, registry, pickIsolatorName(t.name));
      if (wrapped !== t) {
        tools.unregister(t.name);
        tools.register(wrapped);
      }
    }
  };

  const hooks: LifecycleHooks = {
    onInit: async () => {
      wrapDeclaredTools();
    },
    onToolCall: async (ctx) => {
      if (!cfg.enabled) return;
      const tool = tools.get(ctx.call.name);
      if (!tool) return;

      if (!tool.isolation) {
        if (cfg.requireDeclaration) {
          return {
            action: 'deny',
            reason: `security.requireDeclaration: tool '${tool.name}' has no isolation spec`,
          };
        }
        return;
      }

      const isoName = pickIsolatorName(tool.name);
      const iso = registry.get(isoName);
      if (!iso) {
        return {
          action: 'deny',
          reason: `security: configured isolator '${isoName}' is not registered`,
        };
      }
      const required = tool.isolation.required ?? 'none';
      if (ISOLATION_RANK[iso.strength] < ISOLATION_RANK[required]) {
        return {
          action: 'deny',
          reason:
            `security: tool '${tool.name}' requires isolation '${required}' ` +
            `but configured isolator '${iso.name}' is only '${iso.strength}'`,
        };
      }

      // Authoritative enforcement for tools that were NOT wrapped at onInit —
      // MCP tools attached mid-session, hot-reloaded plugins, dynamically
      // registered tools. wrapDeclaredTools() only runs over the registry once
      // (onInit), so a tool that appears afterward keeps its raw handler and
      // would otherwise reach its fs/net work with zero cap enforcement. For an
      // in-process isolator the cap-check IS the enforcement, so run it here;
      // an out-of-process isolator enforces at its boundary, so we defer to it.
      if (!isSecurityWrapped(tool) && IN_PROCESS_STRENGTHS.has(iso.strength)) {
        const verdict = checkAllCaps(ctx.call.input, tool.isolation.capabilities, ctx.cwd, {
          strict: cfg.strict === true,
        });
        if (!verdict.ok) {
          return {
            action: 'deny',
            reason: `security: ${verdict.reason}`,
          };
        }
      }
      return;
    },
  };

  const plugin = definePlugin({
    name: '@moxxy/plugin-security',
    version: '0.0.0',
    hooks,
  });

  return {
    plugin,
    registry,
    audit(): ReadonlyArray<AuditEntry> {
      return tools.list().map((t) => {
        const declared = Boolean(t.isolation);
        const resolved = pickIsolatorName(t.name);
        return {
          tool: t.name,
          declared,
          ...(t.isolation?.required ? { required: t.isolation.required } : {}),
          resolvedIsolator: resolved,
          hasModuleRef: Boolean(t.isolation?.handlerModule),
          ...(t.isolation?.capabilities
            ? { capabilities: t.isolation.capabilities as Record<string, unknown> }
            : {}),
        };
      });
    },
  };
}

/**
 * Replace a tool's handler with one that funnels through the named
 * isolator. Exported for tests and for callers that wrap tools
 * one-at-a-time instead of via the plugin's `onInit`.
 */
export function wrapWithIsolator(
  tool: ToolDef,
  registry: IsolatorRegistry,
  isolatorName: string,
): ToolDef {
  if (!tool.isolation) return tool;
  const iso = registry.get(isolatorName);
  if (!iso) return tool;
  const caps = tool.isolation.capabilities;

  const moduleRef = tool.isolation.handlerModule;
  const wrapped: ToolDef = {
    ...tool,
    handler: async (input: unknown, ctx: ToolContext): Promise<unknown> => {
      const call: IsolatedToolCall = {
        toolName: tool.name,
        input,
        callId: String(ctx.callId),
        sessionId: String(ctx.sessionId),
        turnId: String(ctx.turnId),
        cwd: ctx.cwd,
        ...(moduleRef ? { moduleRef } : {}),
      };
      // The isolator may pass a DERIVED signal (e.g. inproc's timeout-aware
      // controller) so it can actually abort the handler on overrun. Bind the
      // handler to a ctx whose `signal` is that derived signal when provided,
      // falling back to the call's own `ctx.signal`. This is what lets a
      // timed-out handler observe `ctx.signal.aborted` and cancel its in-flight
      // fs/net/exec work, rather than running on past the budget.
      const bound = (i: unknown, derived?: AbortSignal): Promise<unknown> =>
        Promise.resolve(
          tool.handler(i, derived ? { ...ctx, signal: derived } : ctx),
        );
      return iso.run(call, bound, caps, ctx.signal);
    },
  };
  markWrapped(wrapped);
  return wrapped;
}

/**
 * Non-enumerable marker stamped on a tool that `wrapWithIsolator` has already
 * wrapped. `wrapDeclaredTools` checks it so a second `onInit` (e.g. after a hot
 * plugin reload) does NOT re-wrap an already-wrapped tool — re-wrapping would
 * nest `iso.run()` inside `iso.run()`, double-counting cap checks/timeouts and
 * running the real handler under two isolation layers.
 */
const WRAPPED_MARKER = '__moxxySecurityWrapped';

function markWrapped(tool: ToolDef): void {
  Object.defineProperty(tool, WRAPPED_MARKER, {
    value: true,
    enumerable: false,
    configurable: true,
    writable: false,
  });
}

/** True when `wrapWithIsolator` has already wrapped this tool. */
export function isSecurityWrapped(tool: ToolDef): boolean {
  return (tool as unknown as Record<string, unknown>)[WRAPPED_MARKER] === true;
}
