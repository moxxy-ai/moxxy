import type { MoxxyRequirement, ResolvedPluginManifest } from '@moxxy/sdk';

/**
 * Topological sort of discovered plugin manifests by their static
 * `requirements` (from `package.json#moxxy.requirements`). Only
 * `kind: 'plugin'` requirements participate; everything else (runtime,
 * provider-state, etc.) is irrelevant to load order.
 *
 * Behavior:
 * - A manifest whose required plugin name doesn't appear in `manifests`
 *   is left in place — the readiness check in PluginHost will reject it
 *   later. Toposort doesn't pre-judge.
 * - Optional requirements (`optional: true`) are treated as soft edges:
 *   if the target is present we order around it; if not, we skip the
 *   edge silently.
 * - Cycles throw `PluginCycleError` with the participating plugin names
 *   so the caller can surface a useful diagnostic instead of silently
 *   loading in an arbitrary order.
 */
export class PluginCycleError extends Error {
  constructor(readonly cycle: ReadonlyArray<string>) {
    super(`Plugin requirement cycle detected: ${cycle.join(' -> ')}`);
    this.name = 'PluginCycleError';
  }
}

export function toposortPluginManifests(
  manifests: ReadonlyArray<ResolvedPluginManifest>,
): ReadonlyArray<ResolvedPluginManifest> {
  const byPackage = new Map<string, ResolvedPluginManifest>();
  for (const m of manifests) byPackage.set(m.packageName, m);

  const order: ResolvedPluginManifest[] = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (onStack.has(name)) {
      const startIdx = stack.indexOf(name);
      throw new PluginCycleError(stack.slice(startIdx).concat(name));
    }
    const manifest = byPackage.get(name);
    if (!manifest) return; // unknown dep — leave for readiness gate

    onStack.add(name);
    stack.push(name);
    for (const dep of pluginDeps(manifest.requirements)) visit(dep);
    onStack.delete(name);
    stack.pop();
    visited.add(name);
    order.push(manifest);
  };

  for (const m of manifests) visit(m.packageName);
  return order;
}

function pluginDeps(
  requirements: ReadonlyArray<MoxxyRequirement> | undefined,
): ReadonlyArray<string> {
  if (!requirements) return [];
  const out: string[] = [];
  for (const req of requirements) {
    if (req.kind === 'plugin') out.push(req.name);
  }
  return out;
}
