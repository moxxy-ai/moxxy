import { describe, it, expect } from 'vitest';
import { toSpeakableText, toVoiceConversationText } from './speech-text.js';

describe('toSpeakableText', () => {
  it('strips heading markers but keeps the heading text', () => {
    expect(toSpeakableText('## Hello world')).toBe('Hello world.');
  });

  it('keeps link text and drops the URL', () => {
    expect(toSpeakableText('See [the docs](https://example.com) now')).toBe(
      'See the docs now.',
    );
  });

  it('unwraps inline code and emphasis', () => {
    expect(toSpeakableText('Run `npm test` to **verify** the *change*')).toBe(
      'Run npm test to verify the change.',
    );
  });

  it('collapses a fenced code block to a short aside', () => {
    const out = toSpeakableText('Before\n\n```ts\nconst x = 1;\n```\n\nAfter');
    expect(out).toBe('Before. (code block). After.');
  });

  it('strips list bullets and numbers', () => {
    expect(toSpeakableText('- one\n- two\n1. three')).toBe('one two three.');
  });

  it('keeps existing sentence punctuation across paragraphs', () => {
    expect(toSpeakableText('First para.\n\nSecond para.')).toBe(
      'First para. Second para.',
    );
  });

  it('leaves snake_case identifiers intact', () => {
    expect(toSpeakableText('call run_turn now')).toBe('call run_turn now.');
  });

  it('says a link to the site instead of reading out its address', () => {
    expect(toSpeakableText('See https://example.com/x?y=1 for more')).toBe('See a link to example for more.');
    expect(toSpeakableText('Raport jest tutaj: https://github.com/moxxy-ai/moxxy/pull/692.'))
      .toBe('Raport jest tutaj: link do strony github.');
    expect(toSpeakableText('Zobacz <https://docs.moxxy.ai/voice> i www.bbc.co.uk/news?id=5 teraz.'))
      .toBe('Zobacz link do strony moxxy i link do strony bbc teraz.');
    expect(toSpeakableText('Otwórz `http://127.0.0.1:5173/app` w przeglądarce.')).toBe('Otwórz link w przeglądarce.');
  });

  it('says only the name of a site written as a bare domain', () => {
    expect(toSpeakableText('visit www.example.com today')).toBe('visit example today.');
    expect(toSpeakableText('Wejdź na moxxy.ai i sprawdź.')).toBe('Wejdź na moxxy i sprawdź.');
  });

  it('reads a link by its text, or by its site when the text is an address', () => {
    expect(toSpeakableText(
      'The [blog.google](https://blog.google) announcement is live. Read [the details](https://example.com/news).',
    )).toBe('The blog announcement is live. Read the details.');
    expect(toSpeakableText('Kod jest w repozytorium: [https://github.com/moxxy-ai](https://github.com/moxxy-ai).'))
      .toBe('Kod jest w repozytorium: link do strony github.');
  });

  it('reads a table row by row, every value with the name of its column', () => {
    expect(toSpeakableText([
      'Wyniki:',
      '',
      '| Agent | Wersja | Wynik |',
      '|---|---|---|',
      '| Claude | 2.1 | 9 z 9 |',
      '| Codex | 0.16 | 8 z 9 |',
    ].join('\n'))).toBe('Wyniki: Claude: Wersja 2.1; Wynik 9 z 9. Codex: Wersja 0.16; Wynik 8 z 9.');
  });

  it('keeps fractions, dates and units that look like paths', () => {
    expect(toSpeakableText('Pół to 1/2 szklanki.')).toBe('Pół to 1/2 szklanki.');
    expect(toSpeakableText('Jechał 50 km/h przez miasto.')).toBe('Jechał 50 km/h przez miasto.');
    expect(toSpeakableText('Termin to 12/05/2026.')).toBe('Termin to 12/05/2026.');
    expect(toSpeakableText('Łącze ma 300 Mb/s.')).toBe('Łącze ma 300 Mb/s.');
  });

  it('keeps acronym pairs and either-or words that look like paths', () => {
    expect(toSpeakableText('GitLab używa CI/CD, a nie Actions.')).toBe('GitLab używa CI/CD, a nie Actions.');
    expect(toSpeakableText('Test A/B przez TCP/IP.')).toBe('Test A/B przez TCP/IP.');
    expect(toSpeakableText('Wybierz i/lub zamknij.')).toBe('Wybierz i/lub zamknij.');
    expect(toSpeakableText('Use this and/or that.')).toBe('Use this and/or that.');
  });

  it('keeps a Polish abbreviation that looks like a domain', () => {
    expect(toSpeakableText('Testy obejmują m.in. logowanie.')).toBe('Testy obejmują m.in. logowanie.');
  });

  it('keeps the degree sign of a temperature', () => {
    expect(toSpeakableText('Na dworze jest 20°C.')).toBe('Na dworze jest 20°C.');
  });

  it('keeps an e-mail address readable', () => {
    expect(toSpeakableText('Napisz na jan@example.com dzisiaj.')).toBe('Napisz na jan@example.com dzisiaj.');
  });

  it('omits local and repository file paths', () => {
    expect(toSpeakableText(
      'Open `/Users/kamil/project/src/main.ts:12` and `packages/app/src/main.ts` now.',
    )).toBe('Open and now.');
    expect(toSpeakableText('The file is /Users/kamil/My Folder/report.pdf. It is ready.'))
      .toBe('The file is. It is ready.');
  });

  it('keeps product names that look like a file extension', () => {
    expect(toSpeakableText('Node.js handles this.')).toBe('Node.js handles this.');
  });

  it('omits emoji and dangling Markdown stars from spoken output', () => {
    expect(toSpeakableText('Gotowe ✅ 😊 👋🏽 **')).toBe('Gotowe.');
    expect(toSpeakableText('Tryb polski 🇵🇱 1️⃣')).toBe('Tryb polski.');
  });
});

describe('toVoiceConversationText', () => {
  it('removes fenced code instead of announcing a code block', () => {
    const markdown = [
      'Zrobiłem potrzebną zmianę.',
      '',
      '```ts',
      'const greeting = "hello";',
      '```',
      '',
      'Teraz sprawdzam wynik.',
    ].join('\n');

    expect(toVoiceConversationText(markdown)).toBe(
      'Zrobiłem potrzebną zmianę. Teraz sprawdzam wynik.',
    );
  });

  it('returns no speech for a response fragment containing only code', () => {
    expect(toVoiceConversationText('```bash\npnpm test\n```')).toBe('');
  });

  it('omits unfinished and indented code blocks as the turn is closing', () => {
    expect(toVoiceConversationText('Gotowe.\n\n```ts\nconst value = 1;')).toBe('Gotowe.');
    expect(toVoiceConversationText(
      'Wyjaśnienie.\n\n    const value = 1;\n    return value;\n\nWynik jest poprawny.',
    )).toBe('Wyjaśnienie. Wynik jest poprawny.');
  });

  it('keeps the existing read-aloud code summary unchanged', () => {
    expect(toSpeakableText('```bash\npnpm test\n```')).toBe('(code block).');
  });

  it('keeps emoji visible in the transcript but silent in Voice Mode', () => {
    expect(toVoiceConversationText('Jasne 😊 — zrobię to 👋✨ **')).toBe(
      'Jasne — zrobię to.',
    );
    expect(toVoiceConversationText('👋😊✨')).toBe('');
  });

  it('does not speak URL labels or paths in Voice Mode', () => {
    expect(toVoiceConversationText(
      '[blog.google](https://blog.google/news) Dalsze szczegóły są w pliku `packages/app/src/main.ts`.',
    )).toBe('blog Dalsze szczegóły są w pliku.');
  });
});

describe('speaking text built to be slow', () => {
  it('stays fast when nothing closes them', () => {
    const started = performance.now();
    toSpeakableText('('.repeat(50_000));
    toSpeakableText('<'.repeat(50_000));
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('stays fast on a link or an address that ends in a long run of commas', () => {
    const started = performance.now();
    toSpeakableText(`[${','.repeat(50_000)}x](https://example.com)`);
    toSpeakableText(`https://example.com/${','.repeat(50_000)}x`);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('stays fast on a long path that never reaches a file name', () => {
    const started = performance.now();
    toSpeakableText(`[x${'/a'.repeat(25_000)}!](https://example.com)`);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
