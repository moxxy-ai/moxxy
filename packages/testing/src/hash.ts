import { createHash } from 'node:crypto';
import type { ProviderRequest } from '@moxxy/sdk';

export function hashRequest(req: ProviderRequest): string {
  const stable = {
    model: req.model,
    system: req.system ?? '',
    messages: req.messages,
    tools: (req.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
  };
  return createHash('sha256').update(stableStringify(stable)).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
