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
  // Path of names from the current root, mirroring the old recursion stack so a
  // detected cycle reports the same participating names.
  const path: string[] = [];

  // Explicit-stack iterative DFS (instead of recursion) so a pathological deep
  // linear dependency chain — depth is plugin-author/package-controlled via
  // package.json#moxxy.requirements — can't overflow the call stack and turn a
  // load-time ordering concern into a process crash.
  type Frame = { name: string; deps: ReadonlyArray<string>; next: number };

  const visitRoot = (root: string): void => {
    if (visited.has(root)) return;
    const rootManifest = byPackage.get(root);
    if (!rootManifest) return; // unknown dep — leave for readiness gate

    const stack: Frame[] = [{ name: root, deps: pluginDeps(rootManifest.requirements), next: 0 }];
    onStack.add(root);
    path.push(root);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      if (frame.next < frame.deps.length) {
        const dep = frame.deps[frame.next++];
        if (dep === undefined) continue;
        if (visited.has(dep)) continue;
        if (onStack.has(dep)) {
          const startIdx = path.indexOf(dep);
          throw new PluginCycleError(path.slice(startIdx).concat(dep));
        }
        const depManifest = byPackage.get(dep);
        if (!depManifest) continue; // unknown dep — leave for readiness gate
        onStack.add(dep);
        path.push(dep);
        stack.push({ name: dep, deps: pluginDeps(depManifest.requirements), next: 0 });
        continue;
      }
      // All deps emitted → post-order emit this frame, same as the recursive
      // version pushed after its dependency loop.
      const done = stack.pop()!;
      onStack.delete(done.name);
      path.pop();
      visited.add(done.name);
      const manifest = byPackage.get(done.name);
      if (manifest) order.push(manifest);
    }
  };

  for (const m of manifests) visitRoot(m.packageName);
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
