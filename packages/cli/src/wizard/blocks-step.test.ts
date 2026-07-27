import { describe, expect, it } from 'vitest';
import type { CategoryView } from '@moxxy/sdk';
import { partitionCategories, summariseBlocks } from './blocks-step.js';

const view = (category: string, active: string | null, names: string[]): CategoryView => ({
  category,
  active,
  floor: null,
  items: names.map((name) => ({ name, isDefault: name === active })),
});

describe('partitionCategories', () => {
  // The rule that keeps this from being ceremony: on a fresh install most
  // categories hold exactly one registration, and asking "which compactor?"
  // when there is one compactor teaches the user the wizard wastes their time.
  it('only offers a swap where there is genuinely an alternative', () => {
    const { swappable, fixed } = partitionCategories([
      view('cacheStrategy', 'stable-prefix', ['stable-prefix', 'none']),
      view('compactor', 'summarize-old-turns', ['summarize-old-turns']),
    ]);
    expect(swappable.map((s) => s.category)).toEqual(['cacheStrategy']);
    expect(fixed.map((f) => f.category)).toEqual(['compactor']);
  });

  // Onboarding already has a dedicated provider step with credential handling.
  it('never offers provider, which has its own step', () => {
    const { swappable, fixed } = partitionCategories([
      view('provider', 'anthropic', ['anthropic', 'openai']),
    ]);
    expect(swappable).toEqual([]);
    expect(fixed).toEqual([]);
  });

  // "transcriber: (none)" during setup invites a question the user cannot act
  // on until they install something.
  it('drops categories with nothing registered', () => {
    const { swappable, fixed } = partitionCategories([view('transcriber', null, [])]);
    expect(swappable).toEqual([]);
    expect(fixed).toEqual([]);
  });
});

describe('summariseBlocks', () => {
  it('lists what each block resolves to and flags the ones with options', () => {
    const out = summariseBlocks([
      view('mode', 'default', ['default']),
      view('cacheStrategy', 'stable-prefix', ['stable-prefix', 'none']),
    ]);
    expect(out).toContain('mode');
    expect(out).toContain('default');
    expect(out).toContain('2 options');
  });

  it('is empty when nothing is registered, so the step can skip itself', () => {
    expect(summariseBlocks([view('transcriber', null, [])])).toBe('');
  });
});
