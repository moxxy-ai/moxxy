/**
 * Inter-plugin service registry. A plugin can **publish** a named service in its
 * `onInit` hook (e.g. the vault plugin publishes its secret store) and another
 * plugin can **consume** it in its own `onInit` — decoupling cross-plugin
 * dependencies from the host's constructor wiring so a plugin can be
 * discovery-loaded (default-exported, no `build*({deps})` closure) instead of
 * hand-built by the orchestrator.
 *
 * Ordering is by plugin requirements: declare `moxxy.requirements` on the
 * consumer (e.g. `@moxxy/plugin-oauth` requires `@moxxy/plugin-vault`) so the
 * provider's `onInit` runs first and the service is registered before the
 * consumer resolves it. Exposed on {@link AppContext.services}.
 *
 * Plugin `onInit` already runs with full in-process privileges (the security
 * isolation wraps *tool* execution, not plugin code), so reaching a sibling
 * plugin's service here doesn't widen the effective trust surface.
 */
export interface ServiceRegistry {
  /** Publish a named service for other plugins to consume in their `onInit`. */
  register<T>(name: string, impl: T): void;
  /** Resolve a published service, or `undefined` when it isn't registered. */
  get<T>(name: string): T | undefined;
  /**
   * Resolve a published service or throw — use when a declared requirement
   * guarantees the provider ran first.
   */
  require<T>(name: string): T;
  /** Whether a service has been published. */
  has(name: string): boolean;
}
