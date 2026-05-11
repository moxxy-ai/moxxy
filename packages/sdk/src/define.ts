import type { Channel, ChannelAvailability, ChannelDef, ChannelFactoryDeps } from './channel.js';
import type { CompactorDef } from './compactor.js';
import type { LoopStrategyDef } from './loop.js';
import type { PermissionRule } from './permission.js';
import type { Plugin, PluginSpec } from './plugin.js';
import type { ProviderDef } from './provider.js';
import type { SkillDef, SkillFrontmatter } from './skill.js';
import type { ToolContext, ToolDef } from './tool.js';
import type { z } from 'zod';

export function definePlugin(spec: PluginSpec): Plugin {
  return Object.freeze({
    __moxxy: 'plugin' as const,
    version: spec.version ?? '0.0.0',
    ...spec,
  });
}

export function defineTool<S extends z.ZodTypeAny, O = unknown>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  inputJsonSchema?: unknown;
  outputSchema?: z.ZodType<O>;
  permission?: PermissionRule;
  handler: (input: z.output<S>, ctx: ToolContext) => Promise<O> | O;
}): ToolDef {
  return Object.freeze({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    inputJsonSchema: spec.inputJsonSchema,
    outputSchema: spec.outputSchema,
    permission: spec.permission,
    handler: spec.handler as (input: unknown, ctx: ToolContext) => Promise<unknown> | unknown,
  });
}

export function defineProvider(spec: ProviderDef): ProviderDef {
  return Object.freeze(spec);
}

export function defineLoopStrategy(spec: LoopStrategyDef): LoopStrategyDef {
  return Object.freeze(spec);
}

export function defineCompactor(spec: CompactorDef): CompactorDef {
  return Object.freeze(spec);
}

export function defineChannel<TStartOpts = unknown>(spec: {
  name: string;
  description: string;
  create: (deps: ChannelFactoryDeps) => Channel<TStartOpts>;
  isAvailable?: (deps: ChannelFactoryDeps) => Promise<ChannelAvailability>;
}): ChannelDef<TStartOpts> {
  return Object.freeze(spec);
}

export function definePermission(spec: PermissionRule): PermissionRule {
  return Object.freeze(spec);
}

export function defineSkill(spec: { frontmatter: SkillFrontmatter; body: string }): SkillDef {
  return Object.freeze(spec);
}
