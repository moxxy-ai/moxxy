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

  it('switches from Polish to ordinary English prose without inheriting the Polish voice', () => {
    expect(detectSpeechLanguage('Great, everything works correctly.', 'pl')).toBe('en');
  });

  it('treats the spoken code-block placeholder as English after Polish prose', () => {
    expect(detectSpeechLanguage('(code block).', 'pl')).toBe('en');
  });

  it('does not keep Polish for an unresolved multi-word English fragment', () => {
    expect(detectSpeechLanguage('Alpha beta gamma delta.', 'pl')).toBe('en');
  });

  it('still recognizes conversational Polish without diacritics after English', () => {
    expect(detectSpeechLanguage('Dobra, wszystko dziala poprawnie.', 'en')).toBe('pl');
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

  it.each([
    'Mieszkam przy ul. Długiej i czekam na odpowiedź serwera.',
    'Testy obejmują m.in. logowanie oraz wysyłkę wiadomości.',
    'Spotkanie jest o godz. ósmej w głównym biurze firmy.',
    'Trwało to ok. pięć minut i zakończyło się sukcesem.',
    'Budżet wynosi 5 tys. złotych i starczy na cały kwartał.',
    'Budowę skończono w 2025 r. po bardzo długiej przerwie.',
    'To jest Smith vs. Jones w sądzie najwyższym stanu.',
  ])('keeps one sentence across an abbreviation: %s', (sentence) => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push(`${sentence} `)).toEqual([sentence]);
  });

  it('does not end a sentence on a Polish ordinal', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Zajęliśmy 2. miejsce w tegorocznym rankingu. ')).toEqual([
      'Zajęliśmy 2. miejsce w tegorocznym rankingu.',
    ]);
  });

  it('still ends a sentence on a number', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Wynik końcowy tego testu to 2. Teraz sprawdzam kolejny. ')).toEqual([
      'Wynik końcowy tego testu to 2.',
      'Teraz sprawdzam kolejny.',
    ]);
  });

  it('does not split a clock time at its colon', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Najpierw pójdą zaległe zadania z wczoraj, a dzisiejsze z 10:10 dopiero po nich. ')).toEqual([
      'Najpierw pójdą zaległe zadania z wczoraj, a dzisiejsze z 10:10 dopiero po nich.',
    ]);
    expect(segmenter.push('Zaległe skończą się więc mniej więcej około godziny 10:40. ')).toEqual([
      'Zaległe skończą się więc mniej więcej około godziny 10:40.',
    ]);
  });

  it('keeps the number of a list item with its text', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Co się stanie:\n\n1. **10:00:** otwierasz laptopa.\n2. Moxxy zaczyna pracę.\n')).toEqual([
      'Co się stanie:',
      '1. **10:00:** otwierasz laptopa.',
      '2. Moxxy zaczyna pracę.',
    ]);
  });

  it('keeps a web address inside its sentence', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push(
      'Raport jest tutaj: https://github.com/moxxy-ai/moxxy/pull/692. Więcej w [dokumentacji](https://docs.moxxy.ai/voice) albo na www.moxxy.ai/blog?id=5. ',
    )).toEqual([
      'Raport jest tutaj: https://github.com/moxxy-ai/moxxy/pull/692.',
      'Więcej w [dokumentacji](https://docs.moxxy.ai/voice) albo na www.moxxy.ai/blog?id=5.',
    ]);
  });

  it('waits for the rest of an address that arrives in two pieces', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Wejdź na https://docs.moxxy.')).toEqual([]);
    expect(segmenter.push('ai/voice i sprawdź. ')).toEqual(['Wejdź na https://docs.moxxy.ai/voice i sprawdź.']);
  });

  it('still says a sentence the text ends on at once', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Zaraz to sprawdzę.')).toEqual(['Zaraz to sprawdzę.']);
  });

  it('reads a table row by row once the table is complete', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Oto wyniki:\n| Agent | Wynik |\n|---|---|\n| Claude | 9 z 9. Bez uwag |\n')).toEqual([
      'Oto wyniki:',
    ]);
    expect(segmenter.push('| Codex | 8 z 9 |\n\nKoniec. ')).toEqual([
      'Claude: Wynik 9 z 9. Bez uwag.',
      'Codex: Wynik 8 z 9.',
      'Koniec.',
    ]);
  });

  it('reads a table written without the pipes at the edges', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Oto wyniki:\nAgent | Wynik\n--- | ---\nClaude | 9 z 9. Bez uwag\nCodex | 8 z 9\n\nKoniec. ')).toEqual([
      'Oto wyniki:',
      'Claude: Wynik 9 z 9. Bez uwag.',
      'Codex: Wynik 8 z 9.',
      'Koniec.',
    ]);
  });

  it('keeps a sentence with a pipe in it as a sentence', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('Użyj a | b w powłoce. Potem sprawdź wynik.\nI gotowe. ')).toEqual([
      'Użyj a | b w powłoce.',
      'Potem sprawdź wynik.',
      'I gotowe.',
    ]);
  });

  it('reads a table that ends the reply', () => {
    const segmenter = new IncrementalSpeechSegmenter();
    expect(segmenter.push('| Agent | Wynik |\n|---|---|\n| Claude | 9 z 9 |')).toEqual([]);
    expect(segmenter.flush()).toEqual(['Claude: Wynik 9 z 9.']);
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
