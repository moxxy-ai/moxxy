import { describe, expect, it } from 'vitest';
import {
  splitWhatsAppText,
  WHATSAPP_MAX_MESSAGE_CHARS,
} from './turn-runner.js';

describe('splitWhatsAppText', () => {
  it('returns a single chunk when under the cap', () => {
    expect(splitWhatsAppText('hello')).toEqual(['hello']);
  });

  it('splits on newline boundaries when possible', () => {
    const a = 'a'.repeat(30);
    const b = 'b'.repeat(30);
    const chunks = splitWhatsAppText(`${a}\n${b}`, 40);
    expect(chunks).toEqual([a, b]);
  });

  it('never emits a chunk longer than maxLen', () => {
    const text = 'x'.repeat(WHATSAPP_MAX_MESSAGE_CHARS * 2 + 123);
    const chunks = splitWhatsAppText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(WHATSAPP_MAX_MESSAGE_CHARS);
    expect(chunks.join('')).toBe(text);
  });

  it('hard-splits a single word with no separators', () => {
    const chunks = splitWhatsAppText('y'.repeat(90), 40);
    expect(chunks.map((c) => c.length)).toEqual([40, 40, 10]);
  });
});
