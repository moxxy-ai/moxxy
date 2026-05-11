import { z } from 'zod';

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
  description: z.string().min(1).max(240),
  triggers: z.array(z.string().min(1)).optional(),
  'allowed-tools': z.array(z.string().min(1)).optional(),
  version: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export const pluginManifestSchema = z.object({
  entry: z.string().min(1),
  kind: z
    .union([
      z.enum(['tools', 'provider', 'loop', 'compactor', 'mcp', 'cli', 'hooks']),
      z.array(z.enum(['tools', 'provider', 'loop', 'compactor', 'mcp', 'cli', 'hooks'])),
    ])
    .optional(),
  skills: z.string().optional(),
});

export type SkillFrontmatterInput = z.infer<typeof skillFrontmatterSchema>;
export type PluginManifestInput = z.infer<typeof pluginManifestSchema>;
