/** Polish written forms rewritten the way a Polish speaker says them. */

import {
  andAHalf,
  cardinal,
  cardinalBefore,
  cardinalFeminine,
  cardinalNeuter,
  DIGITS,
  ordinal,
  ordinalFormFor,
  pick,
  type OrdinalForm,
  type PluralForms,
} from './polish-numbers.js';
import {
  ACRONYM_PAIR,
  MAX_NUMBER_AFTER_NAME,
  capitalized,
  digitsOf,
  dropTags,
  endsSentence,
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
  wordAfter,
  wordBefore,
  type Expansion,
  type Pass,
} from './shared.js';

const NUMBER = '\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+';
const MAX_SPOKEN_DIGITS = 12;

const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'] as const;
const MONTH_NAMES = MONTHS.join('|');

const LETTERS: Readonly<Record<string, string>> = {
  A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'ef', G: 'gie', H: 'ha', I: 'i', J: 'jot', K: 'ka', L: 'el', M: 'em',
  N: 'en', O: 'o', P: 'pe', Q: 'ku', R: 'er', S: 'es', T: 'te', U: 'u', V: 'fał', W: 'wu', X: 'iks', Y: 'igrek', Z: 'zet',
};
const SPELLED_ACRONYMS: ReadonlySet<string> = new Set([
  'AI', 'API', 'AWS', 'CI', 'CD', 'CPU', 'CSS', 'CLI', 'CSV', 'GPT', 'GPU', 'HTML', 'ID', 'IDE', 'IP', 'MCP', 'ONZ', 'OS',
  'PR', 'QA', 'RAM', 'SDK', 'SQL', 'UE', 'UI', 'URL', 'USA', 'USB', 'UX', 'XML',
]);

/** Every abbreviation that reaches the voice unexpanded is read letter by letter. */
const ABBREVIATIONS: readonly Expansion[] = [
  [word('m\\.\\s?in\\.', 'giu'), 'między innymi'],
  [word('np\\.', 'giu'), 'na przykład'],
  [word('tj\\.', 'giu'), 'to jest'],
  [word('tzn\\.', 'giu'), 'to znaczy'],
  [word('tzw\\.', 'giu'), 'tak zwany'],
  [word('ul\\.', 'giu'), 'ulicy'],
  [word('al\\.', 'giu'), 'alei'],
  [word('godz\\.', 'giu'), 'godzina'],
  [word('prof\\.', 'giu'), 'profesor'],
  [word('inż\\.', 'giu'), 'inżynier'],
  [word('mgr', 'giu'), 'magister'],
  [word('wg', 'giu'), 'według'],
  [word('tel\\.', 'giu'), 'telefon'],
  [word('dr', 'giu'), 'doktor'],
  [word('nr', 'giu'), 'numer'],
  [word('VS Code', 'gu'), 'Visual Studio Code'],
  [word('vs\\.?', 'giu'), 'versus'],
  [word('i/lub', 'giu'), 'i lub'],
  ACRONYM_PAIR,
];
const CLOSING_ABBREVIATIONS: readonly Expansion[] = [
  [word('itd\\.', 'gu'), 'i tak dalej'],
  [word('itp\\.', 'gu'), 'i tym podobne'],
];
/** "ok." is an abbreviation only before a number: after a sentence it means "okay". */
const NUMBERED_ABBREVIATIONS: readonly Expansion[] = [
  [/(?<![\p{L}\p{N}])ok\.(?=\s*\d)/gu, 'około'],
  [/(?<![\p{L}\p{N}])pkt(?=\s*\d)/gu, 'punkt'],
  [/[~≈]\s*(?=\d)/gu, 'około '],
];

/** English terms a Polish reading gets wrong; measured against a recognizer. */
const RESPELLINGS: readonly Expansion[] = [
  [word('openai', 'giu'), 'ołpen ej aj'],
  [word('pull request(\\p{L}*)', 'giu'), 'pul rikłest'],
  [word('commit(\\p{L}*)', 'giu'), 'komit'],
  [word('push', 'giu'), 'pusz'],
  [word('feature(\\p{L}*)', 'giu'), 'ficzer'],
  [word('json(\\p{L}*)', 'giu'), 'dżejson'],
  [word('package(\\p{L}*)', 'giu'), 'pakedż'],
  [word('github', 'giu'), 'githab'],
  [word('pipeline(\\p{L}*)', 'giu'), 'pajplajn'],
  [word('branch(\\p{L}*)', 'giu'), 'brancz'],
  [word('refactor(\\p{L}*)', 'giu'), 'refaktor'],
  [word('pnpm', 'giu'), 'pe en pe em'],
  [word('npm', 'giu'), 'en pe em'],
  [word('README', 'gu'), 'ridmi'],
];

const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  css: 'ce es es',
  csv: 'ce es fał',
  html: 'ha te em el',
  js: 'dżej es',
  json: 'dżejson',
  jsx: 'dżej es iks',
  md: 'em de',
  pdf: 'pe de ef',
  py: 'pe igrek',
  sh: 'es ha',
  ts: 'te es',
  tsx: 'te es iks',
  txt: 'te iks te',
  yaml: 'jaml',
  yml: 'jaml',
};

interface Currency {
  readonly main: PluralForms;
  readonly small: PluralForms;
  readonly neuter?: boolean;
}

const CURRENCIES: Readonly<Record<string, Currency>> = {
  zł: { main: ['złoty', 'złote', 'złotych'], small: ['grosz', 'grosze', 'groszy'] },
  '€': { main: ['euro', 'euro', 'euro'], small: ['cent', 'centy', 'centów'], neuter: true },
  $: { main: ['dolar', 'dolary', 'dolarów'], small: ['cent', 'centy', 'centów'] },
  '£': { main: ['funt', 'funty', 'funtów'], small: ['pens', 'pensy', 'pensów'] },
};
const CURRENCY_CODES: Readonly<Record<string, string>> = { PLN: 'zł', EUR: '€', USD: '$', GBP: '£' };
const CURRENCY_MARK = 'zł|PLN|EUR|USD|GBP|€|\\$|£';

interface Scale {
  readonly forms: PluralForms;
  readonly genitive: string;
}

const SCALES: Readonly<Record<string, Scale>> = {
  tys: { forms: ['tysiąc', 'tysiące', 'tysięcy'], genitive: 'tysiąca' },
  mln: { forms: ['milion', 'miliony', 'milionów'], genitive: 'miliona' },
  mld: { forms: ['miliard', 'miliardy', 'miliardów'], genitive: 'miliarda' },
};
const SCALE_MARK = '(tys\\.?|mln|mld)';

interface Unit {
  readonly forms: PluralForms;
  readonly genitive: string;
  readonly feminine?: boolean;
  /** Said after the noun whatever the number: "kilometrów na godzinę". */
  readonly after?: string;
}

const unit = (one: string, few: string, many: string, genitive: string, extra: Partial<Unit> = {}): Unit =>
  ({ forms: [one, few, many], genitive, ...extra });

const KILOMETER = unit('kilometr', 'kilometry', 'kilometrów', 'kilometra');
const METER = unit('metr', 'metry', 'metrów', 'metra');
const MEGABIT = unit('megabit', 'megabity', 'megabitów', 'megabita');
const GIGABIT = unit('gigabit', 'gigabity', 'gigabitów', 'gigabita');
const MEGABYTE = unit('megabajt', 'megabajty', 'megabajtów', 'megabajta');
const GIGABYTE = unit('gigabajt', 'gigabajty', 'gigabajtów', 'gigabajta');
const DEGREE = unit('stopień', 'stopnie', 'stopni', 'stopnia');
const PER_HOUR = { after: 'na godzinę' };
const PER_SECOND = { after: 'na sekundę' };

const UNITS: Readonly<Record<string, Unit>> = {
  'km/h': { ...KILOMETER, ...PER_HOUR },
  'm/s': { ...METER, ...PER_SECOND },
  'Mb/s': { ...MEGABIT, ...PER_SECOND },
  'Gb/s': { ...GIGABIT, ...PER_SECOND },
  'MB/s': { ...MEGABYTE, ...PER_SECOND },
  'GB/s': { ...GIGABYTE, ...PER_SECOND },
  '°C': { ...DEGREE, after: 'Celsjusza' },
  '°F': { ...DEGREE, after: 'Fahrenheita' },
  '%': unit('procent', 'procent', 'procent', 'procenta'),
  km: KILOMETER,
  cm: unit('centymetr', 'centymetry', 'centymetrów', 'centymetra'),
  mm: unit('milimetr', 'milimetry', 'milimetrów', 'milimetra'),
  m: METER,
  kg: unit('kilogram', 'kilogramy', 'kilogramów', 'kilograma'),
  mg: unit('miligram', 'miligramy', 'miligramów', 'miligrama'),
  g: unit('gram', 'gramy', 'gramów', 'grama'),
  ml: unit('mililitr', 'mililitry', 'mililitrów', 'mililitra'),
  l: unit('litr', 'litry', 'litrów', 'litra'),
  KB: unit('kilobajt', 'kilobajty', 'kilobajtów', 'kilobajta'),
  kB: unit('kilobajt', 'kilobajty', 'kilobajtów', 'kilobajta'),
  MB: MEGABYTE,
  GB: GIGABYTE,
  TB: unit('terabajt', 'terabajty', 'terabajtów', 'terabajta'),
  Mb: MEGABIT,
  Gb: GIGABIT,
  ms: unit('milisekunda', 'milisekundy', 'milisekund', 'milisekundy', { feminine: true }),
  min: unit('minuta', 'minuty', 'minut', 'minuty', { feminine: true }),
  sek: unit('sekunda', 'sekundy', 'sekund', 'sekundy', { feminine: true }),
  godz: unit('godzina', 'godziny', 'godzin', 'godziny', { feminine: true }),
  s: unit('sekunda', 'sekundy', 'sekund', 'sekundy', { feminine: true }),
  h: unit('godzina', 'godziny', 'godzin', 'godziny', { feminine: true }),
  szt: unit('sztuka', 'sztuki', 'sztuk', 'sztuki', { feminine: true }),
  pkt: unit('punkt', 'punkty', 'punktów', 'punktu'),
  px: unit('piksel', 'piksele', 'pikseli', 'piksela'),
};
const UNIT_MARK = Object.keys(UNITS)
  .sort((left, right) => right.length - left.length)
  .join('|');

const LARGEST_SPOKEN_DENOMINATOR = 10;

function wholeOf(written: string): number {
  return Number(digitsOf(written));
}

/** Digits after a decimal mark: short ones as a number, the rest one at a time. */
function fractionWords(digits: string): string {
  const zeros = /^0*/u.exec(digits);
  const leading = zeros ? zeros[0].length : 0;
  if (digits.length > 3 || leading === digits.length) return spellDigits(digits, DIGITS);
  const rest = digits.slice(leading);
  return [spellDigits('0'.repeat(leading), DIGITS), cardinal(Number(rest))].filter(Boolean).join(' ');
}

function decimalWords(whole: string, fraction: string): string {
  return `${cardinal(wholeOf(whole))} przecinek ${fractionWords(fraction)}`;
}

function decimalOf(whole: string, fraction: string, genitive: string, feminine: boolean): string {
  return fraction === '5'
    ? andAHalf(wholeOf(whole), genitive, feminine)
    : `${decimalWords(whole, fraction)} ${genitive}`;
}

function readDate(day: number, month: number, year: number, tail: string): string | null {
  const name = MONTHS[month - 1];
  if (!name || day < 1 || day > 31) return null;
  return `${ordinal(day, 'genM')} ${name} ${ordinal(year, 'genM')}${tail}`;
}

const readNumericDates: Pass = (text) => text
  .replace(word('(\\d{1,2})[./](\\d{1,2})[./](\\d{4})'), (written, day: string, month: string, year: string) =>
    readDate(Number(day), Number(month), Number(year), '') ?? written)
  .replace(word('(\\d{4})-(\\d{2})-(\\d{2})'), (written, year: string, month: string, day: string) =>
    readDate(Number(day), Number(month), Number(year), '') ?? written);

const YEAR_MARK = '(r\\.|rok\\p{L}*)';

function yearTail(mark: string | undefined, whole: string, end: number): string {
  if (!mark) return '';
  if (mark === 'r.') return ` roku${endsSentence(whole, end) ? '.' : ''}`;
  return ` ${mark}`;
}

const readSpelledDates: Pass = (text) => text.replace(
  word(`(\\d{1,2})\\.?\\s+(${MONTH_NAMES})(?:\\s+(\\d{4})(?:\\s*${YEAR_MARK})?)?`),
  (written, day: string, month: string, year: string | undefined, mark: string | undefined, offset: number, whole: string) => {
    const spoken = `${ordinal(Number(day), 'genM')} ${month}`;
    if (!year) return spoken;
    return `${spoken} ${ordinal(Number(year), 'genM')}${yearTail(mark, whole, offset + written.length)}`;
  },
);

function yearFormFor(before: string, mark: string | undefined): OrdinalForm {
  if (mark === 'rok') return 'nomM';
  if (mark === 'rokiem') return 'locM';
  return before === 'w' ? 'locM' : 'genM';
}

/** A four-digit number is a year only where the sentence says so. */
const readYears: Pass = (text) => text
  .replace(word(`(\\d{4})\\s*${YEAR_MARK}`), (written, year: string, mark: string, offset: number, whole: string) =>
    `${ordinal(Number(year), yearFormFor(wordBefore(whole, offset), mark))}${yearTail(mark, whole, offset + written.length)}`)
  .replace(/(?<![\p{L}\p{N}])(w|z|od|do|po)\s+((?:19|20)\d{2})(?=[.,;:!?]|$)/giu, (_written, before: string, year: string) =>
    `${before} ${ordinal(Number(year), before.toLowerCase() === 'w' ? 'locM' : 'genM')}`);

const readDecades: Pass = (text) => text.replace(
  word('(lata|latach|lat)\\s+(\\d0)\\.?'),
  (_written, noun: string, decade: string) => `${noun} ${ordinal(Number(decade), noun === 'lata' ? 'nomN' : 'genP')}`,
);

const TIME_TAKES_INSTRUMENTAL = new Set(['przed', 'za', 'pod', 'nad', 'między', 'godziną']);
const TIME_TAKES_GENITIVE = new Set(['o', 'po', 'od', 'do', 'około', 'koło', 'godzinie', 'godziny']);

function timeFormAfter(before: string): OrdinalForm {
  if (TIME_TAKES_INSTRUMENTAL.has(before)) return 'insF';
  return TIME_TAKES_GENITIVE.has(before) ? 'genF' : 'nomF';
}

function twoDigitMinutes(minutes: number): string {
  if (minutes === 0) return '';
  return minutes < 10 ? `zero ${cardinal(minutes)}` : cardinal(minutes);
}

const readTimes: Pass = (text) => text.replace(
  /(?<![\p{L}\p{N}:.,])([01]?\d|2[0-4]):([0-5]\d)(?::([0-5]\d))?(?![\p{L}\p{N}:])/gu,
  (_written, hour: string, minutes: string, seconds: string | undefined, offset: number, whole: string) =>
    [
      ordinal(Number(hour), timeFormAfter(wordBefore(whole, offset))),
      twoDigitMinutes(Number(minutes)),
      seconds ? twoDigitMinutes(Number(seconds)) : '',
    ].filter(Boolean).join(' '),
);

function dottedWords(written: string): string {
  return written.split('.').map((part) =>
    part.length > 1 && part.startsWith('0') ? spellDigits(part, DIGITS) : cardinal(Number(part))).join(' kropka ');
}

const readVersions: Pass = (text) => text
  .replace(word('[vV](\\d+(?:\\.\\d+)*)'), (_written, version: string, offset: number, whole: string) => {
    const before = wordBefore(whole, offset);
    if (/^wers/u.test(before)) return dottedWords(version);
    return `${before === 'w' ? 'wersji' : 'wersję'} ${dottedWords(version)}`;
  })
  .replace(word('\\d+\\.\\d+'), (written, offset: number, whole: string) =>
    /^wers/u.test(wordBefore(whole, offset)) ? dottedWords(written) : written)
  .replace(word('\\d+(?:\\.\\d+){2,}'), dottedWords);

function scaledAmount(whole: string, fraction: string | undefined, mark: string): string {
  const scale = SCALES[mark.replace('.', '')];
  if (!scale) return whole;
  if (fraction) return decimalOf(whole, fraction, scale.genitive, false);
  const value = wholeOf(whole);
  return value === 1 ? scale.forms[0] : `${cardinal(value)} ${pick(value, scale.forms)}`;
}

function readMoney(whole: string, fraction: string | undefined, scale: string | undefined, mark: string): string {
  const currency = CURRENCIES[CURRENCY_CODES[mark] ?? mark];
  if (!currency) return whole;
  if (scale) return `${scaledAmount(whole, fraction, scale)} ${currency.main[2]}`;
  const value = wholeOf(whole);
  const count = currency.neuter ? cardinalNeuter(value) : cardinal(value);
  const main = `${count} ${pick(value, currency.main)}`;
  const cents = Number((fraction ?? '').padEnd(2, '0'));
  return cents > 0 ? `${main} ${cardinal(cents)} ${pick(cents, currency.small)}` : main;
}

const AMOUNT = `(${NUMBER})(?:[,.](\\d{1,2}))?`;
const OPTIONAL_SCALE = `(?:\\s*${SCALE_MARK})?`;

const readAmounts: Pass = (text) => text
  .replace(
    word(`${AMOUNT}${OPTIONAL_SCALE}\\s*(${CURRENCY_MARK})`),
    (_written, whole: string, fraction: string | undefined, scale: string | undefined, mark: string) =>
      readMoney(whole, fraction, scale, mark),
  )
  .replace(
    word(`(€|\\$|£)\\s*${AMOUNT}${OPTIONAL_SCALE}`),
    (_written, mark: string, whole: string, fraction: string | undefined, scale: string | undefined) =>
      readMoney(whole, fraction, scale, mark),
  )
  .replace(
    word(`(${NUMBER})(?:[,.](\\d+))?\\s*${SCALE_MARK}`),
    (_written, whole: string, fraction: string | undefined, scale: string) => scaledAmount(whole, fraction, scale),
  );

function readUnit(whole: string, fraction: string | undefined, written: string): string {
  const spec = UNITS[written];
  if (!spec) return whole;
  const feminine = spec.feminine === true;
  const after = spec.after ? ` ${spec.after}` : '';
  if (fraction) return `${decimalOf(whole, fraction, spec.genitive, feminine)}${after}`;
  const value = wholeOf(whole);
  return `${feminine ? cardinalFeminine(value) : cardinal(value)} ${pick(value, spec.forms)}${after}`;
}

const readUnits: Pass = (text) => text
  .replace(
    word(`(${NUMBER})(?:[,.](\\d+))?\\s*(${UNIT_MARK})\\.?`),
    (written, whole: string, fraction: string | undefined, mark: string) => {
      const spoken = readUnit(whole, fraction, mark);
      return written.endsWith('.') ? `${spoken}.` : spoken;
    },
  )
  .replace(
    /(?<![\p{L}\p{N}])(\d+),5\s+(sekundy|minuty|godziny)(?![\p{L}\p{N}])/gu,
    (_written, whole: string, noun: string) => andAHalf(Number(whole), noun, true),
  )
  .replace(
    /(?<![\p{L}\p{N}])(\d+),5\s+(roku|miesiąca|tygodnia|dnia|raza)(?![\p{L}\p{N}])/gu,
    (_written, whole: string, noun: string) => andAHalf(Number(whole), noun, false),
  );

const readOrdinals: Pass = (text) => text
  .replace(/(?<![\p{L}\p{N}.,])(\d{1,4})\.\s+(?=\p{Ll})/gu, (written, value: string, offset: number, whole: string) =>
    `${ordinal(Number(value), ordinalFormFor(wordAfter(whole, offset + written.length)))} `);

function fractionOf(numerator: number, denominator: number): string {
  const form = pick(numerator, ['nomF', 'nomN', 'genP']) as OrdinalForm;
  return `${cardinalFeminine(numerator)} ${ordinal(denominator, form)}`;
}

const readFractions: Pass = (text) => text.replace(
  /(?<![\p{L}\p{N}/])(\d+)\/(\d+)(?![\p{L}\p{N}/])/gu,
  (_written, top: string, bottom: string) => {
    const numerator = Number(top);
    const denominator = Number(bottom);
    return numerator < denominator && denominator <= LARGEST_SPOKEN_DENOMINATOR && denominator > 1
      ? fractionOf(numerator, denominator)
      : `${cardinal(numerator)} na ${cardinal(denominator)}`;
  },
);

const readArithmetic: Pass = (text) => text
  .replace(/(?<=\d)\s*\+\s*(?=\d)/gu, ' plus ')
  .replace(/(?<![=!<>])\s*=\s*(?![=>])/gu, ' równa się ')
  .replace(/(?<=\d)\s*[×*]\s*(?=\d)/gu, ' razy ')
  .replace(/(?<=\d)\s*x\s*(?=\d)/gu, ' na ')
  .replace(/(?<=\d):(?=\d)/gu, ' na ')
  .replace(/(?<![\p{L}\p{N}.,:/-])(\d+)\s*[-–—]\s*(\d+)(?![\p{L}\p{N}/-])/gu, (_written, left: string, right: string) =>
    `${left} ${Number(right) > Number(left) ? 'do' : 'minus'} ${right}`)
  .replace(/(?<=^|[\s(])[-−](?=\d)/gmu, 'minus ');

const ROMAN_NOUNS_MASCULINE = 'rozdział|tom|punkt|etap|akt|sezon|paragraf';
const ROMAN_NOUNS_FEMININE = 'część|klasa|liga';

const readRomanNumerals: Pass = (text) => text
  .replace(word(`(${ROMAN})\\s+(wiek\\p{L}*|w\\.)`), (written, roman: string, noun: string, offset: number, whole: string) => {
    const value = romanValue(roman);
    if (value === null) return written;
    if (noun === 'wiek') return `${ordinal(value, 'nomM')} wiek`;
    return `${ordinal(value, wordBefore(whole, offset) === 'w' ? 'locM' : 'genM')} wieku`;
  })
  .replace(word(`(${ROMAN})\\s+(wojn\\p{L}*)`), (written, roman: string, noun: string) => {
    const value = romanValue(roman);
    if (value === null) return written;
    const form: OrdinalForm = noun === 'wojna' ? 'nomF' : noun === 'wojnę' ? 'insF' : 'genF';
    return `${ordinal(value, form)} ${noun}`;
  })
  .replace(word(`(${ROMAN_NOUNS_MASCULINE})\\s+(${ROMAN})`, 'giu'), (written, noun: string, roman: string) => {
    const value = romanValue(roman);
    return value === null ? written : `${noun} ${ordinal(value, 'nomM')}`;
  })
  .replace(word(`(${ROMAN_NOUNS_FEMININE})\\s+(${ROMAN})`, 'giu'), (written, noun: string, roman: string) => {
    const value = romanValue(roman);
    return value === null ? written : `${noun} ${ordinal(value, 'nomF')}`;
  })
  .replace(word(`(\\p{Lu}\\p{Ll}+)\\s+(${ROMAN})`), (written, name: string, roman: string) => {
    const value = romanValue(roman);
    if (value === null || value > MAX_NUMBER_AFTER_NAME || roman.length < 2) return written;
    return `${name} ${capitalized(ordinal(value, name.endsWith('a') ? 'nomF' : 'nomM'))}`;
  });

const readSymbols: Pass = (text) => text
  .replace(/(?<![\p{L}\p{N}])C\+\+/gu, 'ce plus plus')
  .replace(/(?<![\p{L}\p{N}])C#/gu, 'ce szarp')
  .replace(/(?<![\p{L}\p{N}])F#/gu, 'ef szarp')
  .replace(/(?<=\p{L})\s*&\s*(?=\p{L})/gu, ' i ')
  .replace(/#(\d+)(?![\p{L}\p{N}])/gu, 'numer $1')
  .replace(/\+\d[\d -]{6,}\d/gu, (written) => spellDigits(digitsOf(written), DIGITS));

/** Letters glued to a number, such as MP3, GPT-4 and 4K. */
const readLetteredNumbers: Pass = (text) => text
  .replace(word('([A-Z]{2,})(\\d+)'), (_written, letters: string, digits: string) =>
    `${spellLetters(letters, LETTERS)} ${digits}`)
  .replace(word('(\\d+)([A-Z])'), (_written, digits: string, letter: string) =>
    `${digits} ${LETTERS[letter] ?? letter}`)
  .replace(/(?<=\p{L})-(?=\d)/gu, ' ');

const readDecimals: Pass = (text) => text
  .replace(word('(\\d+),(\\d+)'), (_written, whole: string, fraction: string) => decimalWords(whole, fraction))
  .replace(word('(\\d+)\\.(\\d+)'), (_written, whole: string, fraction: string) =>
    `${cardinal(Number(whole))} kropka ${fractionWords(fraction)}`);

const readWholeNumbers: Pass = (text) => text.replace(word(NUMBER), (written, offset: number, whole: string) => {
  const digits = digitsOf(written);
  if (digits.length > MAX_SPOKEN_DIGITS || (digits.length > 1 && digits.startsWith('0'))) return spellDigits(digits, DIGITS);
  return cardinalBefore(Number(digits), wordAfter(whole, offset + written.length));
});

/** Order matters: dates and times first, while their digits still look like them. */
const PASSES: readonly Pass[] = [
  dropTags,
  readEmails('małpa', 'kropka'),
  expand(NUMBERED_ABBREVIATIONS),
  expand(ABBREVIATIONS),
  expandClosing(CLOSING_ABBREVIATIONS),
  readNumericDates,
  readSpelledDates,
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
  readFileNames('kropka', FILE_EXTENSIONS),
  respell(RESPELLINGS),
  readLetteredNumbers,
  readAcronyms({ letters: LETTERS, vowels: /[AĄEĘIOÓUY]/u, spelled: SPELLED_ACRONYMS }),
  readArithmetic,
  readDecimals,
  readWholeNumbers,
  readLeftoverDigits(DIGITS),
  tidy,
];

export function polishSpeech(text: string): string {
  return PASSES.reduce((current, pass) => pass(current), text);
}

