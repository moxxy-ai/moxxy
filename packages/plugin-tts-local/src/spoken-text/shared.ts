/** The pieces every language's rules are built from. */

export type Pass = (text: string) => string;

/** A pattern plus what to say instead. */
export type Expansion = readonly [pattern: RegExp, spoken: string];

/** `pattern` as whole words. `\b` only knows ASCII, so it would split "ół". */
export function word(pattern: string, flags = 'gu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
}

export function digitsOf(written: string): string {
  return written.replace(/\D/gu, '');
}

/** The word right before `offset`, lowercased, dots kept ("godz."). */
export function wordBefore(text: string, offset: number): string {
  const match = /([\p{L}.]+)\s*$/u.exec(text.slice(0, offset));
  return match ? (match[1] ?? '').toLowerCase() : '';
}

/** The word starting after `end`, as written. */
export function wordAfter(text: string, end: number): string {
  const match = /^\s*(\p{L}+)/u.exec(text.slice(end));
  return match ? (match[1] ?? '') : '';
}

/** Whether a dot at `end` closes the sentence, so it has to stay as a pause. */
export function endsSentence(text: string, end: number): boolean {
  return /^\s*(?:$|\p{Lu})/u.test(text.slice(end));
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** `spoken`, capitalized when `written` opens with a capital. */
export function inCaseOf(written: string, spoken: string): string {
  return /^\p{Lu}/u.test(written) ? capitalized(spoken) : spoken;
}

export function expand(expansions: readonly Expansion[]): Pass {
  return (text) => expansions.reduce(
    (current, [pattern, spoken]) => current.replace(pattern, (written) => inCaseOf(written, spoken)),
    text,
  );
}

/** Terms spelled for the voice, which keep no capitals: they are not words anyone reads. */
export function respell(respellings: readonly Expansion[]): Pass {
  return (text) => respellings.reduce(
    (current, [pattern, spoken]) => current.replace(pattern, (_written, ...groups: unknown[]) =>
      `${spoken}${typeof groups[0] === 'string' ? groups[0] : ''}`),
    text,
  );
}

/** An abbreviation whose dot may also be the end of the sentence. */
export function expandClosing(expansions: readonly Expansion[]): Pass {
  return (text) => expansions.reduce(
    (current, [pattern, spoken]) => current.replace(pattern, (written, offset: number, whole: string) =>
      `${spoken}${endsSentence(whole, offset + written.length) ? '.' : ''}`),
    text,
  );
}

/** Tags are never spoken: the model has no emphasis tag and reads most of them out. */
export const dropTags: Pass = (text) => text.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/giu, '');

export function readEmails(at: string, dot: string): Pass {
  return (text) => text.replace(
    /([\p{L}\p{N}._+-]+)@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/gu,
    (_written, user: string, domain: string) =>
      `${user.replaceAll('.', ` ${dot} `)} ${at} ${domain.replaceAll('.', ` ${dot} `)}`,
  );
}

/** Anything still holding a digit is read one digit at a time, so a number can
 *  never reach the voice as digits, which it reads wrongly or not at all. */
export function readLeftoverDigits(digitWords: readonly string[]): Pass {
  return (text) => text.replace(/\d/gu, (digit) => ` ${digitWords[Number(digit)] ?? ''} `);
}

export function spellDigits(digits: string, digitWords: readonly string[]): string {
  return [...digits].map((digit) => digitWords[Number(digit)] ?? '').join(' ');
}

export const tidy: Pass = (text) => text
  .replace(/[ \t\u00a0]+/gu, ' ')
  .replace(/ +([.,;:!?)])/gu, '$1')
  .trim();

const ROMAN_NUMERAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/u;
const ROMAN_DIGITS: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** The value of a Roman numeral, or null when `written` is not one. */
export function romanValue(written: string): number | null {
  if (!written || !ROMAN_NUMERAL.test(written)) return null;
  const values = [...written].map((digit) => ROMAN_DIGITS[digit] ?? 0);
  return values.reduce((sum, value, index) => {
    const next = values[index + 1] ?? 0;
    return sum + (value < next ? -value : value);
  }, 0);
}

export const ROMAN = '[IVXLCDM]+';

export interface AcronymRules {
  /** How each letter is said; the spelled letters are joined with a space. */
  readonly letters: Readonly<Record<string, string>>;
  /** Vowels of the language: a capitalized word without one cannot be a word. */
  readonly vowels: RegExp;
  /** Spelled even though they hold a vowel. */
  readonly spelled: ReadonlySet<string>;
}

export function spellLetters(written: string, letters: Readonly<Record<string, string>>): string {
  return [...written].map((letter) => letters[letter] ?? letter).join(' ');
}

/** Spell what can only be an acronym. Other capitals stay a word: "NIE" is shouting. */
export function readAcronyms({ letters, vowels, spelled }: AcronymRules): Pass {
  return (text) => text.replace(word('[A-ZĄĆĘŁŃÓŚŹŻ]{2,8}'), (written) =>
    spelled.has(written) || !vowels.test(written) ? spellLetters(written, letters) : written);
}
