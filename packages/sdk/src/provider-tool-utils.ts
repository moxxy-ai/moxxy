import type { ModelDescriptor } from './provider.js';
import type { HostedTool, ToolDef } from './tool.js';

export interface ResolvedProviderTools {
  /** Client-executed tools that should still be serialized as function tools. */
  readonly tools: ReadonlyArray<ToolDef>;
  /** Provider-hosted tools that replace matching client fallbacks. */
  readonly hostedTools: ReadonlyArray<HostedTool>;
}

/**
 * Enable the active model's advertised hosted tools and remove only matching
 * duplicate client fallbacks. Unknown model ids deliberately keep every local
 * fallback: stale catalog data must never silently drop a callable tool.
 */
export function resolveProviderTools(
  tools: ReadonlyArray<ToolDef> | undefined,
  models: ReadonlyArray<ModelDescriptor>,
  modelId: string,
): ResolvedProviderTools {
  const descriptor = models.find((model) => model.id === modelId);
  const supported = new Set(descriptor?.hostedTools ?? []);
  const clientTools: ToolDef[] = [];
  const hostedTools: HostedTool[] = Array.from(supported, (type) => ({ type }));

  for (const tool of tools ?? []) {
    const hosted = tool.hosted;
    if (!hosted || !supported.has(hosted.type)) {
      clientTools.push(tool);
    }
  }
  return { tools: clientTools, hostedTools };
}
