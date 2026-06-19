import { definePlugin, type AgentDef, type Plugin } from '@moxxy/sdk';
import { buildDispatchAgentTool, type DispatchAgentDeps } from './dispatch-agent.js';

export { buildDispatchAgentTool, type DispatchAgentDeps } from './dispatch-agent.js';

export interface BuildSubagentsPluginOpts {
  /**
   * How the tool resolves an `agentType` name → AgentDef at handler
   * time. Pass a closure that reads from your session's agent registry:
   * `(name) => session.agents.get(name)`.
   *
   * Defaults to "no agents registered" (always falls back to the
   * built-in default kind). Useful for standalone tests / scripts that
   * don't want to wire a session.
   */
  readonly getAgent?: (name: string) => AgentDef | undefined;
  /**
   * Live snapshot of the parent's tool names, e.g.
   * `() => session.tools.list().map((t) => t.name)`. When provided, a child
   * that neither the caller nor its kind restricts is defaulted to the
   * parent's tools MINUS `dispatch_agent` — cutting unbounded recursive
   * fan-out (8^N sessions). Omit to keep full unrestricted inheritance.
   */
  readonly getToolNames?: () => ReadonlyArray<string>;
}

/**
 * `@moxxy/plugin-subagents` — adds the dispatch_agent tool + the
 * auto-detection skill ("dispatch-agents") that triggers on fan-out
 * patterns. Without this plugin the model can't spawn subagents — the
 * normal single-loop flow runs as usual.
 *
 * Other plugins can ship `AgentDef` kinds via their own
 * `PluginSpec.agents`. This plugin's tool resolves them at runtime, so
 * a freshly-installed agent kind becomes available the next time the
 * model calls dispatch_agent — no restart needed.
 */
export function buildSubagentsPlugin(opts: BuildSubagentsPluginOpts = {}): Plugin {
  const deps: DispatchAgentDeps = {
    getAgent: opts.getAgent ?? (() => undefined),
    ...(opts.getToolNames ? { getToolNames: opts.getToolNames } : {}),
  };
  return definePlugin({
    name: '@moxxy/plugin-subagents',
    version: '0.0.0',
    tools: [buildDispatchAgentTool(deps)],
  });
}

export const subagentsPlugin = buildSubagentsPlugin();

export default subagentsPlugin;
