import { describe, expect, it } from 'vitest';
import { splitForReadAloud } from './read-aloud-parts.js';

describe('splitForReadAloud', () => {
  it('keeps a message that fits as one part', () => {
    const text = 'First sentence. Second sentence!\n\nA new paragraph?';
    expect(splitForReadAloud(text, 3_000)).toEqual(['First sentence.\nSecond sentence!\nA new paragraph?']);
  });

  it('cuts a long message only between sentences, each part within the limit', () => {
    const sentence = (n: number): string => `Sentence number ${n} is here.`;
    const text = Array.from({ length: 12 }, (_, n) => sentence(n)).join(' ');

    const parts = splitForReadAloud(text, 100);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(100);
    expect(parts.join('\n')).toBe(Array.from({ length: 12 }, (_, n) => sentence(n)).join('\n'));
  });

  it('counts what is spoken, so a long code block does not push prose into another part', () => {
    const code = `\`\`\`ts\n${'const x = 1;\n'.repeat(40)}\`\`\``;
    const text = `Look at this:\n\n${code}\n\nThat is all.`;
    expect(splitForReadAloud(text, 100)).toHaveLength(1);
  });

  it('gives nothing for an empty message', () => {
    expect(splitForReadAloud('   ', 3_000)).toEqual([]);
  });
});
