import { describe, it, expect } from 'vitest';
import { toSpeakableText, toVoiceConversationText } from './speech.js';

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

  it('strips bare URLs so they are not read aloud', () => {
    expect(toSpeakableText('See https://example.com/x?y=1 for more')).toBe('See for more.');
    expect(toSpeakableText('visit www.example.com today')).toBe('visit today.');
  });

  it('drops URL-like link labels while keeping descriptive link text', () => {
    expect(toSpeakableText(
      'The [blog.google](https://blog.google) announcement is live. Read [the details](https://example.com/news).',
    )).toBe('The announcement is live. Read the details.');
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
    )).toBe('Dalsze szczegóły są w pliku.');
  });
});
