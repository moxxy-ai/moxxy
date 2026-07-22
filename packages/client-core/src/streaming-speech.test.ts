import { describe, expect, it } from 'vitest';

import {
  IncrementalSpeechSegmenter,
  detectSpeechLanguage,
} from './streaming-speech.js';

describe('detectSpeechLanguage', () => {
  it('detects Polish with and without diacritics', () => {
    expect(detectSpeechLanguage('Cześć, mogę już odpowiedzieć na twoje pytanie.')).toBe('pl');
    expect(detectSpeechLanguage('Mam problem z kodem i potrzebuje pomocy.')).toBe('pl');
  });

  it('detects English prose', () => {
    expect(detectSpeechLanguage('This component is ready and the tests are passing.')).toBe('en');
  });

  it('does not switch a Polish sentence because of technical English identifiers', () => {
    expect(detectSpeechLanguage('Uruchom pnpm test i sprawdź komponent useEffect.')).toBe('pl');
  });

  it('uses the previous language for an ambiguous short fragment', () => {
    expect(detectSpeechLanguage('OK.', 'pl')).toBe('pl');
    expect(detectSpeechLanguage('OK.', 'en')).toBe('en');
  });
});

describe('IncrementalSpeechSegmenter', () => {
  it('emits complete sentences while retaining the unfinished tail', () => {
    const segmenter = new IncrementalSpeechSegmenter();

    expect(segmenter.push('Cześć, zaraz ')).toEqual([]);
    expect(segmenter.push('odpowiem. This is ')).toEqual(['Cześć, zaraz odpowiem.']);
    expect(segmenter.push('English!')).toEqual(['This is English!']);
    expect(segmenter.flush()).toEqual([]);
  });

  it('does not split common Polish and English abbreviations', () => {
    const segmenter = new IncrementalSpeechSegmenter();

    expect(segmenter.push('To jest np. wersja testowa. Dr. Smith uses e.g. Vitest.')).toEqual([
      'To jest np. wersja testowa.',
      'Dr. Smith uses e.g. Vitest.',
    ]);
  });

  it('forces a natural word-boundary chunk for a very long sentence', () => {
    const segmenter = new IncrementalSpeechSegmenter({ maxChars: 56 });
    const chunks = segmenter.push(
      'To jest bardzo długie zdanie bez kropki które powinno zacząć mówić zanim model skończy całą odpowiedź',
    );

    expect(chunks).toEqual(['To jest bardzo długie zdanie bez kropki które powinno']);
    expect(segmenter.flush()).toEqual(['zacząć mówić zanim model skończy całą odpowiedź']);
  });

  it('does not force a chunk while a fenced code block is still open', () => {
    const segmenter = new IncrementalSpeechSegmenter({ maxChars: 32 });

    expect(segmenter.push('```ts\nconst greeting = "hello from a long code block";\n')).toEqual([]);
    expect(segmenter.push('```\nGotowe.')).toEqual([
      '```ts\nconst greeting = "hello from a long code block";\n```\nGotowe.',
    ]);
  });

  it('flushes the final incomplete phrase when the turn completes', () => {
    const segmenter = new IncrementalSpeechSegmenter();

    expect(segmenter.push('Ostatni fragment bez kropki')).toEqual([]);
    expect(segmenter.flush()).toEqual(['Ostatni fragment bez kropki']);
    expect(segmenter.flush()).toEqual([]);
  });
});
