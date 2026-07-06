import { describe, expect, it } from 'vitest';
import {
  ChunkedSender,
  IMESSAGE_CHUNK_HARD_LIMIT,
  splitForImessage,
  takeChunk,
} from './chunker.js';

describe('takeChunk', () => {
  it('holds short text for the final flush', () => {
    expect(takeChunk('hello world')).toBeNull();
    expect(takeChunk('x'.repeat(1_500))).toBeNull();
  });

  it('splits at a paragraph boundary once past the soft limit', () => {
    const text = 'a'.repeat(1_200) + '\n\n' + 'b'.repeat(600);
    const taken = takeChunk(text);
    expect(taken).not.toBeNull();
    expect(taken?.chunk).toBe('a'.repeat(1_200));
    expect(taken?.rest).toBe('b'.repeat(600));
  });

  it('falls back to newline, then word boundaries', () => {
    const nl = 'a'.repeat(1_200) + '\n' + 'b'.repeat(600);
    expect(takeChunk(nl)?.chunk).toBe('a'.repeat(1_200));
    const word = 'a'.repeat(1_200) + ' ' + 'b'.repeat(600);
    expect(takeChunk(word)?.chunk).toBe('a'.repeat(1_200));
  });

  it('never returns a chunk above the hard limit (hard cut when boundary-less)', () => {
    const text = 'x'.repeat(IMESSAGE_CHUNK_HARD_LIMIT + 500);
    const taken = takeChunk(text);
    expect(taken).not.toBeNull();
    expect(taken?.chunk.length).toBe(IMESSAGE_CHUNK_HARD_LIMIT);
    expect(taken?.rest.length).toBe(500);
  });

  it('waits for more text when boundary-less but under the hard limit', () => {
    expect(takeChunk('x'.repeat(1_800))).toBeNull();
  });

  it('ignores boundaries too early to form a meaningful chunk', () => {
    const text = '\n\n' + 'x'.repeat(1_700);
    expect(takeChunk(text)).toBeNull();
  });
});

describe('splitForImessage', () => {
  it('returns short text as a single message', () => {
    expect(splitForImessage('hi')).toEqual(['hi']);
  });

  it('drops pure whitespace', () => {
    expect(splitForImessage('   \n ')).toEqual([]);
  });

  it('splits long text into under-limit pieces', () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `${'p'.repeat(700)}${i}`).join('\n\n');
    const parts = splitForImessage(paragraphs);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(IMESSAGE_CHUNK_HARD_LIMIT);
    expect(parts.join('')).toContain('p'.repeat(700) + '7');
  });
});

describe('ChunkedSender', () => {
  function collector(): { sent: string[]; send: (t: string) => Promise<void> } {
    const sent: string[] = [];
    return {
      sent,
      send: async (t) => {
        sent.push(t);
      },
    };
  }

  it('buffers below the soft limit and flushes once on finalize', async () => {
    const { sent, send } = collector();
    const sender = new ChunkedSender({ send });
    sender.offer('Hello');
    sender.offer('Hello world');
    await sender.finalize('Hello world, done.');
    expect(sent).toEqual(['Hello world, done.']);
  });

  it('streams paragraph chunks as the snapshot grows, then sends only the remainder', async () => {
    const { sent, send } = collector();
    const sender = new ChunkedSender({ send, limits: { softLimit: 20, hardLimit: 60 } });
    sender.offer('first paragraph text\n\nsecond');
    await sender.finalize('first paragraph text\n\nsecond part is done');
    expect(sent).toEqual(['first paragraph text', 'second part is done']);
  });

  it('sends the empty-turn placeholder only when nothing was ever sent', async () => {
    const { sent, send } = collector();
    const sender = new ChunkedSender({ send });
    await sender.finalize('   ', '(no output)');
    expect(sent).toEqual(['(no output)']);
  });

  it('does not send the placeholder when chunks already went out', async () => {
    const { sent, send } = collector();
    const sender = new ChunkedSender({ send, limits: { softLimit: 5, hardLimit: 30 } });
    sender.offer('streamed text already sent\n\nx');
    await sender.finalize('', '(no output)');
    expect(sent).toEqual(['streamed text already sent']);
  });

  it('re-sends the authoritative final text when it diverges from the streamed prefix', async () => {
    const { sent, send } = collector();
    const sender = new ChunkedSender({ send, limits: { softLimit: 10, hardLimit: 40 } });
    sender.offer('streamed draft one\n\nmore text here');
    await sender.finalize('a completely different final answer');
    expect(sent[0]).toBe('streamed draft one');
    expect(sent).toContain('a completely different final answer');
  });

  it('serializes sends in order', async () => {
    const order: string[] = [];
    const sender = new ChunkedSender({
      send: async (t) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(t);
      },
      limits: { softLimit: 4, hardLimit: 12 },
    });
    sender.offer('one two\n\n');
    sender.offer('one two\n\nthree four\n\n');
    await sender.finalize('one two\n\nthree four\n\nfive');
    expect(order).toEqual(['one two', 'three four', 'five']);
  });
});
