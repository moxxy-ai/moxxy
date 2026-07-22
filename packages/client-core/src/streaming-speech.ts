export type SpeechLanguage = 'pl' | 'en';

const POLISH_WORDS: ReadonlySet<string> = new Set([
  'aby',
  'ale',
  'bardzo',
  'będzie',
  'chcę',
  'czy',
  'dla',
  'dlatego',
  'do',
  'działa',
  'gdzie',
  'i',
  'jak',
  'jest',
  'już',
  'kodem',
  'mam',
  'może',
  'możemy',
  'na',
  'nie',
  'odpowiedź',
  'oraz',
  'po',
  'pomocy',
  'potrzebuje',
  'proszę',
  'się',
  'sprawdź',
  'tak',
  'tego',
  'ten',
  'to',
  'twoje',
  'w',
  'więc',
  'z',
  'za',
  'żeby',
]);

const ENGLISH_WORDS: ReadonlySet<string> = new Set([
  'a',
  'and',
  'are',
  'as',
  'can',
  'component',
  'for',
  'from',
  'hello',
  'is',
  'it',
  'of',
  'on',
  'ready',
  'should',
  'tests',
  'that',
  'the',
  'this',
  'to',
  'we',
  'with',
  'you',
  'your',
]);

const POLISH_DIACRITIC_RE = /[ąćęłńóśźż]/giu;
const WORD_RE = /\p{L}+/gu;

/**
 * Lightweight deterministic detector for the two local Piper languages.
 * It deliberately scores prose words rather than identifiers, so `pnpm`,
 * `useEffect`, and other technical names do not make a Polish sentence switch
 * voice. Ambiguous short fragments inherit the preceding segment's language.
 */
export function detectSpeechLanguage(
  text: string,
  previous?: SpeechLanguage,
): SpeechLanguage {
  const lower = text.toLocaleLowerCase();
  const words = lower.match(WORD_RE) ?? [];
  let polish = (lower.match(POLISH_DIACRITIC_RE) ?? []).length * 3;
  let english = 0;

  for (const word of words) {
    if (POLISH_WORDS.has(word)) polish += 2;
    if (ENGLISH_WORDS.has(word)) english += 2;
  }

  if (polish > english) return 'pl';
  if (english > polish) return 'en';
  return previous ?? 'en';
}

export interface IncrementalSpeechSegmenterOptions {
  /** Force a word-boundary chunk once an unfinished sentence grows this long. */
  readonly maxChars?: number;
}

const DEFAULT_MAX_CHARS = 220;
const MIN_CLAUSE_CHARS = 48;
const ABBREVIATIONS: ReadonlyArray<string> = [
  'dr.',
  'e.g.',
  'i.e.',
  'itd.',
  'itp.',
  'mr.',
  'mrs.',
  'ms.',
  'np.',
  'prof.',
  'tj.',
];

/** Incrementally turns provider text deltas into natural speakable chunks. */
export class IncrementalSpeechSegmenter {
  private readonly maxChars: number;
  private buffer = '';

  constructor(options: IncrementalSpeechSegmenterOptions = {}) {
    const requested = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.maxChars = Number.isFinite(requested) && requested >= 24
      ? Math.floor(requested)
      : DEFAULT_MAX_CHARS;
  }

  push(delta: string): string[] {
    if (delta) this.buffer += delta;
    return this.extract(false);
  }

  flush(): string[] {
    const chunks = this.extract(true);
    this.buffer = '';
    return chunks;
  }

  reset(): void {
    this.buffer = '';
  }

  private extract(final: boolean): string[] {
    const chunks: string[] = [];
    while (this.buffer.trim()) {
      const natural = scanNaturalBoundary(this.buffer);
      const forced = natural.boundary === null
        && !natural.protectedAtEnd
        && this.buffer.length > this.maxChars
        ? findWordBoundary(this.buffer, this.maxChars)
        : null;
      const boundary = natural.boundary ?? forced;
      if (boundary === null) break;
      this.take(boundary, chunks);
    }
    if (final && this.buffer.trim()) this.take(this.buffer.length, chunks);
    return chunks;
  }

  private take(boundary: number, chunks: string[]): void {
    const chunk = this.buffer.slice(0, boundary).trim();
    this.buffer = this.buffer.slice(boundary).trimStart();
    if (chunk) chunks.push(chunk);
  }
}

interface NaturalBoundaryScan {
  readonly boundary: number | null;
  readonly protectedAtEnd: boolean;
}

function scanNaturalBoundary(text: string): NaturalBoundaryScan {
  let fence: '```' | '~~~' | null = null;
  let inlineCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const triple = text.slice(i, i + 3);
    if (!inlineCode && (triple === '```' || triple === '~~~')) {
      fence = fence === triple ? null : fence ?? triple;
      i += 2;
      continue;
    }
    if (fence) continue;
    if (text[i] === '`') {
      inlineCode = !inlineCode;
      continue;
    }
    if (inlineCode) continue;

    const char = text[i];
    if (char === '\n' && i > 0 && text[i - 1] === '\n') {
      return { boundary: i + 1, protectedAtEnd: false };
    }
    if (char === '!' || char === '?') {
      return { boundary: includeClosingPunctuation(text, i + 1), protectedAtEnd: false };
    }
    if (char === '.' && isSentencePeriod(text, i)) {
      return { boundary: includeClosingPunctuation(text, i + 1), protectedAtEnd: false };
    }
    if ((char === ';' || char === ':') && i + 1 >= MIN_CLAUSE_CHARS) {
      return { boundary: includeClosingPunctuation(text, i + 1), protectedAtEnd: false };
    }
  }
  return { boundary: null, protectedAtEnd: fence !== null || inlineCode };
}

function isSentencePeriod(text: string, index: number): boolean {
  const previous = text[index - 1];
  const next = text[index + 1];
  if (previous && next && /\d/.test(previous) && /\d/.test(next)) return false;
  const lower = text.toLocaleLowerCase();
  return !ABBREVIATIONS.some((abbreviation) => {
    for (let dot = abbreviation.indexOf('.'); dot >= 0; dot = abbreviation.indexOf('.', dot + 1)) {
      const start = index - dot;
      if (start < 0) continue;
      const before = lower[start - 1];
      if (before && /\p{L}/u.test(before)) continue;
      const candidate = lower.slice(start, start + abbreviation.length);
      if (candidate === abbreviation) return true;
      const prefix = lower.slice(start, index + 1);
      if (index === text.length - 1 && abbreviation.startsWith(prefix)) return true;
    }
    return false;
  });
}

function includeClosingPunctuation(text: string, from: number): number {
  let index = from;
  while (index < text.length && /[.!?"'”’)]/.test(text[index] ?? '')) index += 1;
  return index;
}

function findWordBoundary(text: string, maxChars: number): number | null {
  for (let i = Math.min(maxChars, text.length - 1); i >= 1; i -= 1) {
    if (/\s/.test(text[i] ?? '')) return i;
  }
  return null;
}
