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
  maskEnv,
  type CapCheckResult,
} from './cap-check.js';

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
   * are left untouched. Idempotent — re-running after a hot plugin
   * reload would replace previous wrappers cleanly because each
   * wrapping closes over the same registry.
   */
  const wrapDeclaredTools = (): void => {
    if (!cfg.enabled) return;
    for (const t of tools.list()) {
      if (!t.isolation) continue;
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
      const bound = (i: unknown): Promise<unknown> =>
        Promise.resolve(tool.handler(i, ctx));
      return iso.run(call, bound, caps, ctx.signal);
    },
  };
  return wrapped;
}
