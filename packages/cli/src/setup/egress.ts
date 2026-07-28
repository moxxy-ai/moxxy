// Values live on the Node-only subpath; the erased types ride the main barrel,
// per the split documented in @moxxy/sdk/server.
import { hasProxy, installEgressProxy, readProxyEnv } from '@moxxy/sdk/server';
import type { EgressProxySettings, EgressStatus } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';

/**
 * Resolve the effective proxy settings from config layered over the
 * environment.
 *
 * `network.proxy` precedence, and why:
 *   - unset / `'env'`: the environment decides. The default, so a developer's
 *     existing `HTTPS_PROXY` just works with no moxxy config at all.
 *   - `'off'`:         direct, even when the environment says otherwise.
 *   - a URL:           that proxy, even when the environment says otherwise.
 *     A managed workstation needs this: a user must not be able to route around
 *     the corporate proxy by clearing their shell profile.
 *
 * `network.noProxy` is MERGED with the environment's `no_proxy` rather than
 * replacing it, so pinning a proxy in config never silently drops a bypass the
 * host already depended on (an internal registry, a metadata endpoint).
 */
export function resolveEgressSettings(config?: MoxxyConfig): EgressProxySettings {
  const env = readProxyEnv();
  const mode = config?.network?.proxy;
  const noProxy = mergeNoProxy(env.noProxy, config?.network?.noProxy);

  if (mode === 'off') return {};
  if (mode !== undefined && mode !== 'env') {
    return { httpProxy: mode, httpsProxy: mode, ...(noProxy ? { noProxy } : {}) };
  }
  return { ...env, ...(noProxy ? { noProxy } : {}) };
}

function mergeNoProxy(fromEnv?: string, fromConfig?: string): string | undefined {
  const parts = [fromEnv, fromConfig].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(',') : undefined;
}

/**
 * The settings currently installed on the global dispatcher, so a second call
 * with an identical resolution is a no-op. Boot applies env-only settings
 * before any command runs; session setup re-applies once the config is loaded,
 * and only the second call does work when config actually overrides the env.
 */
let applied: string | null = null;

/**
 * Install (or re-install) the global proxy dispatcher. Idempotent and
 * non-throwing: a bad proxy setting degrades to direct connections plus a
 * warning, never a failed boot.
 *
 * Returns null when the resolved settings are already in force.
 */
export async function applyEgressSettings(config?: MoxxyConfig): Promise<EgressStatus | null> {
  const settings = resolveEgressSettings(config);
  const key = JSON.stringify(settings);
  if (applied === key) return null;
  // Nothing configured and nothing installed yet: record the no-op so the
  // second (config-aware) call can still detect a real change.
  applied = key;
  if (!hasProxy(settings)) return { enabled: false, reason: 'no proxy configured' };
  return await installEgressProxy(settings);
}

/** Test seam: forget what was installed so a suite can re-apply. */
export function resetEgressForTests(): void {
  applied = null;
}
