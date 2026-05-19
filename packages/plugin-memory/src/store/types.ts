import { z } from 'zod';

export const memoryTypeSchema = z.enum(['fact', 'preference', 'project', 'reference']);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const memoryFrontmatterSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
  type: memoryTypeSchema,
  description: z.string().min(1).max(280),
  tags: z.array(z.string().min(1)).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

export interface MemoryEntry {
  readonly frontmatter: MemoryFrontmatter;
  readonly body: string;
  readonly path: string;
}

export type RecallMode = 'auto' | 'vector' | 'keyword';
