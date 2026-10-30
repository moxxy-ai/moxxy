/** English written forms rewritten the way an English speaker says them. */

import { cardinal, DIGITS, ordinal, year as yearWords } from './english-numbers.js';
import {
  ACRONYM_PAIR,
  MAX_NUMBER_AFTER_NAME,
  digitsOf,
  dropTags,
  expand,
  expandClosing,
  readAcronyms,
  readEmails,
  readFileNames,
  readLeftoverDigits,
  respell,
  ROMAN,
  romanValue,
  spellDigits,
  spellLetters,
  tidy,
  word,
  wordBefore,
  type Expansion,
  type Pass,
} from './shared.js';

const NUMBER = '\\d{1,3}(?:,\\d{3})+|\\d+';
const MAX_SPOKEN_DIGITS = 12;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTH_NAMES = 'Jan(?:uary|\\.)?|Feb(?:ruary|\\.)?|Mar(?:ch|\\.)?|Apr(?:il|\\.)?|May|June?|July?|Aug(?:ust|\\.)?|Sep(?:t(?:ember|\\.)?|\\.)?|Oct(?:ober|\\.)?|Nov(?:ember|\\.)?|Dec(?:ember|\\.)?';

/** Written as they sound: spaced capitals run together and "A.I." comes out as "ay". */
const LETTERS: Readonly<Record<string, string>> = {
  A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'ef', G: 'gee', H: 'aitch', I: 'eye', J: 'jay', K: 'kay', L: 'el',
  M: 'em', N: 'en', O: 'oh', P: 'pee', Q: 'cue', R: 'ar', S: 'ess', T: 'tee', U: 'you', V: 'vee', W: 'double you',
  X: 'ex', Y: 'why', Z: 'zee',
};
const SPELLED_ACRONYMS: ReadonlySet<string> = new Set([
  'AI', 'API', 'AWS', 'CEO', 'CI', 'CPU', 'CTO', 'CSS', 'CLI', 'CSV', 'EU', 'GPT', 'GPU', 'HTML', 'ID', 'IDE', 'IP', 'MCP',
  'OS', 'PR', 'QA', 'SDK', 'SQL', 'UI', 'UK', 'URL', 'USA', 'USB', 'UX', 'XML',
]);

const ABBREVIATIONS: readonly Expansion[] = [
  [/(?<![\p{L}\p{N}])e\.g\.,?/gu, 'for example'],
  [/(?<![\p{L}\p{N}])i\.e\.,?/gu, 'that is'],
  [word('Dr\\.'), 'Doctor'],
  [word('Prof\\.'), 'Professor'],
  [word('Mr\\.'), 'Mister'],
  [word('Mrs\\.'), 'Missus'],
  [word('VS Code', 'gu'), 'Visual Studio Code'],
  [word('vs\\.?'), 'versus'],
  [word('and/or', 'giu'), 'and or'],
  ACRONYM_PAIR,
  [word('approx\\.'), 'approximately'],
  [/(?<![\p{L}\p{N}])No\.(?=\s*\d)/gu, 'number'],
  [/[~≈]\s*(?=\d)/gu, 'about '],
];
const CLOSING_ABBREVIATIONS: readonly Expansion[] = [
  [/(?<![\p{L}\p{N}])etc\./gu, 'et cetera'],
];
const RESPELLINGS: readonly Expansion[] = [
  [word('json', 'giu'), 'jason'],
  [word('README', 'gu'), 'read me'],
];

const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  css: 'see ess ess',
  csv: 'see ess vee',
  html: 'aitch tee em el',
  js: 'jay ess',
  json: 'jason',
  jsx: 'jay ess ex',
  md: 'em dee',
  pdf: 'pee dee eff',
  py: 'pie',
  sh: 'ess aitch',
  ts: 'tee ess',
  tsx: 'tee ess ex',
  txt: 'tee ex tee',
  yaml: 'yamel',
  yml: 'yamel',
};

interface Currency {
  readonly main: readonly [one: string, many: string];
  readonly small: readonly [one: string, many: string];
}

const CENTS = ['cent', 'cents'] as const;
const CURRENCIES: Readonly<Record<string, Currency>> = {
  $: { main: ['dollar', 'dollars'], small: CENTS },
  '€': { main: ['euro', 'euros'], small: CENTS },
  '£': { main: ['pound', 'pounds'], small: ['penny', 'pence'] },
  zł: { main: ['zloty', 'zloty'], small: ['grosz', 'groszy'] },
};
const CURRENCY_CODES: Readonly<Record<string, string>> = { USD: '$', EUR: '€', GBP: '£', PLN: 'zł' };
const SCALE_MARK = '(thousand|million|billion|trillion|k)';

interface Unit {
  readonly one: string;
  readonly many: string;
  /** Said after the noun whatever the number: "kilometers per hour". */
  readonly after?: string;
}

const unit = (one: string, extra: Partial<Unit> = {}): Unit => ({ one, many: `${one}s`, ...extra });

const UNITS: Readonly<Record<string, Unit>> = {
  'km/h': unit('kilometer', { after: 'per hour' }),
  'm/s': unit('meter', { after: 'per second' }),
  'Mb/s': unit('megabit', { after: 'per second' }),
  'Gb/s': unit('gigabit', { after: 'per second' }),
  'MB/s': unit('megabyte', { after: 'per second' }),
  'GB/s': unit('gigabyte', { after: 'per second' }),
  mph: unit('mile', { after: 'per hour' }),
  '°C': { one: 'degree', many: 'degrees', after: 'Celsius' },
  '°F': { one: 'degree', many: 'degrees', after: 'Fahrenheit' },
  '%': { one: 'percent', many: 'percent' },
  km: unit('kilometer'),
  cm: unit('centimeter'),
  mm: unit('millimeter'),
  m: unit('meter'),
  kg: unit('kilogram'),
  mg: unit('milligram'),
  g: unit('gram'),
  ml: unit('milliliter'),
  l: unit('liter'),
  KB: unit('kilobyte'),
  kB: unit('kilobyte'),
  MB: unit('megabyte'),
  GB: unit('gigabyte'),
  TB: unit('terabyte'),
  Mb: unit('megabit'),
  Gb: unit('gigabit'),
  ms: unit('millisecond'),
  min: unit('minute'),
  s: unit('second'),
  h: unit('hour'),
  px: { one: 'pixel', many: 'pixels' },
};
const UNIT_MARK = Object.keys(UNITS)
  .sort((left, right) => right.length - left.length)
  .join('|');

const DENOMINATORS: Readonly<Record<number, readonly [one: string, many: string]>> = {
  2: ['half', 'halves'],
  3: ['third', 'thirds'],
  4: ['quarter', 'quarters'],
  5: ['fifth', 'fifths'],
  6: ['sixth', 'sixths'],
  8: ['eighth', 'eighths'],
  10: ['tenth', 'tenths'],
};

function wholeOf(written: string): number {
  return Number(digitsOf(written));
}

function pointWords(whole: string, fraction: string): string {
  return `${cardinal(wholeOf(whole))} point ${spellDigits(fraction, DIGITS)}`;
}

function monthIndex(written: string): number {
  return MONTHS.findIndex((month) => month.startsWith(written.slice(0, 3)));
}

function readDate(month: number, day: number, year: number | null): string | null {
  const name = MONTHS[month];
  if (!name || day < 1 || day > 31) return null;
  return year === null ? `${name} ${ordinal(day)}` : `${name} ${ordinal(day)}, ${yearWords(year)}`;
}

const readDates: Pass = (text) => text
  .replace(word('(\\d{4})-(\\d{2})-(\\d{2})'), (written, year: string, month: string, day: string) =>
    readDate(Number(month) - 1, Number(day), Number(year)) ?? written)
  .replace(word('(\\d{1,2})/(\\d{1,2})/(\\d{4})'), (written, first: string, second: string, year: string) => {
    const dayFirst = Number(first) > 12;
    return readDate(Number(dayFirst ? second : first) - 1, Number(dayFirst ? first : second), Number(year)) ?? written;
  })
  .replace(word(`(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`), (written, month: string, day: string, year: string | undefined) =>
    readDate(monthIndex(month), Number(day), year ? Number(year) : null) ?? written);

const readYears: Pass = (text) => text.replace(
  /(?<![\p{L}\p{N}])(in|since|from|until|by|of|before|after)\s+((?:19|20)\d{2})(?=[.,;:!?]|$)/giu,
  (_written, before: string, year: string) => `${before} ${yearWords(Number(year))}`,
);

function pluralWords(words: string): string {
  return words.endsWith('y') ? `${words.slice(0, -1)}ies` : `${words}s`;
}

/** Runs before units: the "s" of "1990s" is not seconds. */
const readDecades: Pass = (text) => text
  .replace(word('((?:19|20)\\d0)s'), (_written, decade: string) => pluralWords(yearWords(Number(decade))))
  .replace(word('(\\d0)s'), (_written, decade: string) => pluralWords(cardinal(Number(decade))));

function minuteWords(minutes: number): string {
  return minutes < 10 ? `oh ${cardinal(minutes)}` : cardinal(minutes);
}

const readTimes: Pass = (text) => text.replace(
  /(?<![\p{L}\p{N}:.,])([01]?\d|2[0-4]):([0-5]\d)(?::[0-5]\d)?(?:\s*(AM|PM|am|pm|a\.m\.|p\.m\.))?(?![\p{L}\p{N}:])/gu,
  (_written, hour: string, minutes: string, period: string | undefined) => {
    const spoken = Number(minutes) === 0 && !period
      ? `${cardinal(Number(hour))} o'clock`
      : [cardinal(Number(hour)), Number(minutes) > 0 ? minuteWords(Number(minutes)) : ''].filter(Boolean).join(' ');
    if (!period) return spoken;
    return `${spoken} ${/^a/iu.test(period) ? spellLetters('AM', LETTERS) : spellLetters('PM', LETTERS)}`;
  },
);

function dottedWords(written: string): string {
  return written.split('.').map((part) =>
    part.length > 1 && part.startsWith('0') ? spellDigits(part, DIGITS) : cardinal(Number(part))).join(' point ');
}

const readVersions: Pass = (text) => text
  .replace(word('[vV](\\d+(?:\\.\\d+)*)'), (_written, version: string, offset: number, whole: string) =>
    /^version/u.test(wordBefore(whole, offset)) ? dottedWords(version) : `version ${dottedWords(version)}`)
  .replace(word('\\d+\\.\\d+'), (written, offset: number, whole: string) =>
    /^version/u.test(wordBefore(whole, offset)) ? dottedWords(written) : written)
  .replace(word('\\d+(?:\\.\\d+){2,}'), dottedWords);

function scaledAmount(whole: string, fraction: string | undefined, scale: string): string {
  const name = scale === 'k' ? 'thousand' : scale;
  return `${fraction ? pointWords(whole, fraction) : cardinal(wholeOf(whole))} ${name}`;
}

function readMoney(whole: string, fraction: string | undefined, scale: string | undefined, mark: string): string {
  const currency = CURRENCIES[CURRENCY_CODES[mark] ?? mark];
  if (!currency) return whole;
  if (scale) return `${scaledAmount(whole, fraction, scale)} ${currency.main[1]}`;
  const value = wholeOf(whole);
  const main = `${cardinal(value)} ${value === 1 ? currency.main[0] : currency.main[1]}`;
  const cents = Number((fraction ?? '').padEnd(2, '0'));
  if (cents === 0) return main;
  return `${main} ${cardinal(cents)} ${cents === 1 ? currency.small[0] : currency.small[1]}`;
}

const readAmounts: Pass = (text) => text
  .replace(
    word(`(\\$|€|£)\\s*(${NUMBER})(?:\\.(\\d+))?(?:\\s*${SCALE_MARK})?`),
    (_written, mark: string, whole: string, fraction: string | undefined, scale: string | undefined) =>
      readMoney(whole, fraction, scale, mark),
  )
  .replace(
    word(`(${NUMBER})(?:\\.(\\d+))?(?:\\s*${SCALE_MARK})?\\s*(USD|EUR|GBP|PLN|zł|€|£)`),
    (_written, whole: string, fraction: string | undefined, scale: string | undefined, mark: string) =>
      readMoney(whole, fraction, scale, mark),
  );

function readUnit(whole: string, fraction: string | undefined, mark: string): string {
  const spec = UNITS[mark];
  if (!spec) return whole;
  const after = spec.after ? ` ${spec.after}` : '';
  if (fraction) return `${pointWords(whole, fraction)} ${spec.many}${after}`;
  const value = wholeOf(whole);
  return `${cardinal(value)} ${value === 1 ? spec.one : spec.many}${after}`;
}

const readUnits: Pass = (text) => text.replace(
  word(`(${NUMBER})(?:\\.(\\d+))?\\s*(${UNIT_MARK})`),
  (_written, whole: string, fraction: string | undefined, mark: string) => readUnit(whole, fraction, mark),
);

const readOrdinals: Pass = (text) => text.replace(
  word('(\\d+)(?:st|nd|rd|th)'),
  (_written, value: string) => ordinal(Number(value)),
);

const readFractions: Pass = (text) => text.replace(
  /(?<![\p{L}\p{N}/])(\d+)\/(\d+)(?![\p{L}\p{N}/])/gu,
  (_written, top: string, bottom: string) => {
    const numerator = Number(top);
    const denominator = Number(bottom);
    const names = DENOMINATORS[denominator];
    if (names && numerator < denominator) {
      return `${cardinal(numerator)} ${numerator === 1 ? names[0] : names[1]}`;
    }
    return `${cardinal(numerator)} ${numerator < denominator ? 'over ' : ''}${cardinal(denominator)}`;
  },
);

const readArithmetic: Pass = (text) => text
  .replace(/(?<=\d)\s*\+\s*(?=\d)/gu, ' plus ')
  .replace(/(?<![=!<>])\s*=\s*(?![=>])/gu, ' equals ')
  .replace(/(?<=\d)\s*[×*]\s*(?=\d)/gu, ' times ')
  .replace(/(?<=\d)\s*x\s*(?=\d)/gu, ' by ')
  .replace(/(?<=\d):(?=\d)/gu, ' by ')
  .replace(/(?<![\p{L}\p{N}.,:/-])(\d+)\s*[-–—]\s*(\d+)(?![\p{L}\p{N}/-])/gu, (_written, left: string, right: string) =>
    `${left} ${Number(right) > Number(left) ? 'to' : 'minus'} ${right}`)
  .replace(/(?<=^|[\s(])[-−](?=\d)/gmu, 'minus ');

const ROMAN_COUNTED_AFTER = 'Chapter|Part|Volume|Act|Episode|Season|Phase|Stage|Type|War';

const readRomanNumerals: Pass = (text) => text
  .replace(word(`(${ROMAN})\\s+(century|centuries)`), (written, roman: string, noun: string) => {
    const value = romanValue(roman);
    return value === null ? written : `${ordinal(value)} ${noun}`;
  })
  .replace(word(`(${ROMAN_COUNTED_AFTER})\\s+(${ROMAN})`, 'giu'), (written, noun: string, roman: string) => {
    const value = romanValue(roman);
    return value === null ? written : `${noun} ${cardinal(value)}`;
  })
  .replace(word(`(\\p{Lu}\\p{Ll}+)\\s+(${ROMAN})`), (written, name: string, roman: string) => {
    const value = romanValue(roman);
    if (value === null || value > MAX_NUMBER_AFTER_NAME || roman.length < 2) return written;
    const spoken = ordinal(value);
    return `${name} the ${spoken.charAt(0).toUpperCase()}${spoken.slice(1)}`;
  });

const readSymbols: Pass = (text) => text
  .replace(/(?<![\p{L}\p{N}])C\+\+/gu, 'see plus plus')
  .replace(/(?<![\p{L}\p{N}])C#/gu, 'see sharp')
  .replace(/(?<![\p{L}\p{N}])F#/gu, 'ef sharp')
  .replace(/(?<=\p{L})\s*&\s*(?=\p{L})/gu, ' and ')
  .replace(/#(\d+)(?![\p{L}\p{N}])/gu, 'number $1')
  .replace(/\+\d[\d -]{6,}\d/gu, (written) => spellDigits(digitsOf(written), DIGITS));

const readLetteredNumbers: Pass = (text) => text
  .replace(word('([A-Z]{2,})(\\d+)'), (_written, letters: string, digits: string) =>
    `${spellLetters(letters, LETTERS)} ${digits}`)
  .replace(word('(\\d+)([A-Z])'), (_written, digits: string, letter: string) =>
    `${digits} ${LETTERS[letter] ?? letter}`)
  .replace(/(?<=\p{L})-(?=\d)/gu, ' ');

const readDecimals: Pass = (text) => text.replace(
  word('(\\d+)\\.(\\d+)'),
  (_written, whole: string, fraction: string) => pointWords(whole, fraction),
);

const readWholeNumbers: Pass = (text) => text.replace(word(NUMBER), (written) => {
  const digits = digitsOf(written);
  if (digits.length > MAX_SPOKEN_DIGITS || (digits.length > 1 && digits.startsWith('0'))) return spellDigits(digits, DIGITS);
  return cardinal(Number(digits));
});

/** Order matters: dates and times first, while their digits still look like them. */
const PASSES: readonly Pass[] = [
  dropTags,
  readEmails('at', 'dot'),
  expand(ABBREVIATIONS),
  expandClosing(CLOSING_ABBREVIATIONS),
  readDates,
  readYears,
  readDecades,
  readTimes,
  readVersions,
  readAmounts,
  readUnits,
  readOrdinals,
  readFractions,
  readRomanNumerals,
  readSymbols,
  readFileNames('dot', FILE_EXTENSIONS),
  respell(RESPELLINGS),
  readLetteredNumbers,
  readAcronyms({ letters: LETTERS, vowels: /[AEIOUY]/u, spelled: SPELLED_ACRONYMS }),
  readArithmetic,
  readDecimals,
  readWholeNumbers,
  readLeftoverDigits(DIGITS),
  tidy,
];

export function englishSpeech(text: string): string {
  return PASSES.reduce((current, pass) => pass(current), text);
}
