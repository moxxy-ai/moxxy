import { createHash } from 'node:crypto';
import type { ProviderRequest } from '@moxxy/sdk';

/**
 * Controls which {@link ProviderRequest} fields participate in the fixture /
 * byHash key. The default narrows to `model` + `system` + `messages` + tool
 * `name`/`description`; it deliberately IGNORES `temperature`, `maxTokens`, and
 * tool `inputSchema`/`reasoning`/`cacheHints`. Two requests that differ only in
 * those fields collide to the same hash. Callers that vary them and need a
 * stricter key can opt in via {@link HashRequestOptions} rather than the hash
 * narrowing being hardcoded.
 */
export interface HashRequestOptions {
  /** Fold `temperature` + `maxTokens` into the hash. Default: false. */
  readonly includeSamplingParams?: boolean;
  /** Fold each tool's `inputSchema` (JSON-stringified) into the hash. Default: false. */
  readonly includeToolSchemas?: boolean;
}

export function hashRequest(req: ProviderRequest, opts: HashRequestOptions = {}): string {
  const stable: Record<string, unknown> = {
    model: req.model,
    system: req.system ?? '',
    messages: req.messages,
    tools: (req.tools ?? []).map((t) =>
      opts.includeToolSchemas
        ? { name: t.name, description: t.description, inputSchema: safeSchema(t.inputSchema) }
        : { name: t.name, description: t.description },
    ),
  };
  if (opts.includeSamplingParams) {
    stable.temperature = req.temperature ?? null;
    stable.maxTokens = req.maxTokens ?? null;
  }
  return createHash('sha256').update(stableStringify(stable)).digest('hex').slice(0, 16);
}

// Tool inputSchema is an arbitrary value at this seam (a Zod schema in
// production); serialize it best-effort so an unserializable schema can never
// throw out of the hasher.
function safeSchema(schema: unknown): string {
  try {
    return JSON.stringify(schema) ?? '';
  } catch {
    return '';
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
