import type { ToolDef, ToolRegistry } from '@moxxy/sdk';

/** `parent` is the session's registry or one a turn already narrowed (an @ mention withholds tools). */
export function buildFilteredToolRegistry(
  parent: ToolRegistry,
  allowed: Set<string>,
): ToolRegistry {
  return {
    list: (): ReadonlyArray<ToolDef> => parent.list().filter((t) => allowed.has(t.name)),
    get: (name: string): ToolDef | undefined =>
      allowed.has(name) ? parent.get(name) : undefined,
    execute: (name, input, signal, opts) => {
      if (!allowed.has(name)) {
        return Promise.reject(new Error(`Tool ${name} not allowed in this subagent`));
      }
      return parent.execute(name, input, signal, opts);
    },
  };
}
