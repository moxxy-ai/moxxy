import { describe, expect, it } from 'vitest';
import { pluginManifestSchema, skillFrontmatterSchema } from './schemas.js';

describe('skillFrontmatterSchema', () => {
  it('accepts minimal valid frontmatter', () => {
    const parsed = skillFrontmatterSchema.parse({
      name: 'refactor-component',
      description: 'Splits a large React component into smaller files.',
    });
    expect(parsed.name).toBe('refactor-component');
  });

  it('accepts optional fields', () => {
    const parsed = skillFrontmatterSchema.parse({
      name: 'deploy',
      description: 'Deploy to staging.',
      triggers: ['deploy', 'ship'],
      'allowed-tools': ['Bash'],
      version: '1.0.0',
      tags: ['ops'],
    });
    expect(parsed.triggers).toEqual(['deploy', 'ship']);
  });

  it('rejects non-slug names', () => {
    expect(() =>
      skillFrontmatterSchema.parse({ name: 'Refactor Component', description: 'x' }),
    ).toThrow(/slug-like/);
    expect(() =>
      skillFrontmatterSchema.parse({ name: '-bad', description: 'x' }),
    ).toThrow();
  });

  it('rejects names exceeding length cap', () => {
    expect(() =>
      skillFrontmatterSchema.parse({ name: 'a'.repeat(121), description: 'x' }),
    ).toThrow();
  });

  it('rejects empty description', () => {
    expect(() => skillFrontmatterSchema.parse({ name: 'x', description: '' })).toThrow();
  });
});

describe('pluginManifestSchema', () => {
  it('accepts minimal manifest', () => {
    const parsed = pluginManifestSchema.parse({ entry: './src/index.ts' });
    expect(parsed.entry).toBe('./src/index.ts');
  });

  it('accepts kind as scalar or array', () => {
    expect(pluginManifestSchema.parse({ entry: 'a', kind: 'tools' }).kind).toBe('tools');
    expect(pluginManifestSchema.parse({ entry: 'a', kind: ['tools', 'hooks'] }).kind).toEqual([
      'tools',
      'hooks',
    ]);
  });

  it('rejects unknown kind', () => {
    expect(() => pluginManifestSchema.parse({ entry: 'a', kind: 'weird' })).toThrow();
  });
});
