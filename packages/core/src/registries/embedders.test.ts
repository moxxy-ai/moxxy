import type { EmbedderDef, EmbeddingProvider } from '@moxxy/sdk';
import { describe, expect, it, vi } from 'vitest';
import { EmbedderRegistry } from './embedders.js';

function fakeEmbedder(name: string): EmbeddingProvider {
  return { name, dim: 3, embed: async (t) => t.map(() => [0, 0, 0]) };
}

function def(name: string, create: () => EmbeddingProvider): EmbedderDef {
  return { name, createClient: create };
}

describe('EmbedderRegistry', () => {
  it('does not call createClient until the embedder is activated (lazy)', () => {
    const reg = new EmbedderRegistry();
    const create = vi.fn(() => fakeEmbedder('x'));
    reg.register(def('x', create));
    expect(create).not.toHaveBeenCalled();
    expect(reg.has('x')).toBe(true);

    const inst = reg.setActive('x');
    expect(create).toHaveBeenCalledTimes(1);
    expect(inst.name).toBe('x');
    // Re-activating reuses the cached instance.
    reg.setActive('x');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('has no active embedder until one is selected (opt-in)', () => {
    const reg = new EmbedderRegistry();
    reg.register(def('x', () => fakeEmbedder('x')));
    expect(reg.tryGetActive()).toBeNull();
    expect(reg.getActiveName()).toBeNull();
    reg.setActive('x');
    expect(reg.tryGetActive()?.name).toBe('x');
    expect(reg.getActiveName()).toBe('x');
  });

  it('throws on duplicate registration and on activating an unknown name', () => {
    const reg = new EmbedderRegistry();
    reg.register(def('x', () => fakeEmbedder('x')));
    expect(() => reg.register(def('x', () => fakeEmbedder('x')))).toThrow(/already registered/);
    expect(() => reg.setActive('nope')).toThrow(/not registered/);
  });

  it('unregister clears the active slot', () => {
    const reg = new EmbedderRegistry();
    reg.register(def('x', () => fakeEmbedder('x')));
    reg.setActive('x');
    reg.unregister('x');
    expect(reg.has('x')).toBe(false);
    expect(reg.tryGetActive()).toBeNull();
  });
});
