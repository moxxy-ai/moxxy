/** Polish numbers in words, with the agreement a listener expects. */

export type PluralForms = readonly [one: string, few: string, many: string];

export type OrdinalForm = 'nomM' | 'nomF' | 'nomN' | 'genM' | 'genF' | 'locM' | 'insF' | 'genP';

export const DIGITS = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'] as const;
const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'] as const;
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'] as const;
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'] as const;
const SCALES: readonly PluralForms[] = [
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['milion', 'miliony', 'milionów'],
  ['miliard', 'miliardy', 'miliardów'],
];

const ORDINAL_DIGITS = ['zerowy', 'pierwszy', 'drugi', 'trzeci', 'czwarty', 'piąty', 'szósty', 'siódmy', 'ósmy', 'dziewiąty'] as const;
const ORDINAL_TEENS = ['dziesiąty', 'jedenasty', 'dwunasty', 'trzynasty', 'czternasty', 'piętnasty', 'szesnasty', 'siedemnasty', 'osiemnasty', 'dziewiętnasty'] as const;
const ORDINAL_TENS = ['', '', 'dwudziesty', 'trzydziesty', 'czterdziesty', 'pięćdziesiąty', 'sześćdziesiąty', 'siedemdziesiąty', 'osiemdziesiąty', 'dziewięćdziesiąty'] as const;
const ORDINAL_HUNDREDS = ['', 'setny', 'dwusetny', 'trzechsetny', 'czterechsetny', 'pięćsetny', 'sześćsetny', 'siedemsetny', 'osiemsetny', 'dziewięćsetny'] as const;
const ORDINAL_THOUSANDS = ['', 'tysięczny', 'dwutysięczny', 'trzytysięczny'] as const;

/** Endings of an ordinal, after a hard stem ("pierwsz-y") and a soft one ("drug-i"). */
const ORDINAL_ENDINGS: Readonly<Record<OrdinalForm, readonly [hard: string, soft: string]>> = {
  nomM: ['y', 'i'],
  nomF: ['a', 'a'],
  nomN: ['e', 'ie'],
  genM: ['ego', 'iego'],
  genF: ['ej', 'iej'],
  locM: ['ym', 'im'],
  insF: ['ą', 'ą'],
  genP: ['ych', 'ich'],
};

/** Nouns that say "dwie" and "jedna"; a plural noun does not show its gender. */
const FEMININE_NOUN = /^(?:aplikacj|częś|funkcj|gałęz|godzin|ikon|kart|klas|kolumn|komend|kopi|lini|liczb|metod|minut|odpowied|opcj|osob|osób|paczk|prób|rzecz|sekund|sesj|strefy|stron|sztuk|tabel|wersj|wiadomoś|zakładk|zmian|ścieżk)/iu;
const NEUTER_NOUN = /^(?:dzieck|miejsc|narzędzi|okn|polecen|połączeni|pytani|repozytori|słow|urządzeni|ustawieni|zadani|zdani|środowisk)/iu;

export function pick(value: number, forms: PluralForms): string {
  if (value === 1) return forms[0];
  const lastDigit = value % 10;
  const lastTwo = value % 100;
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? forms[1] : forms[2];
}

function belowThousand(value: number): string[] {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const words: string[] = hundreds > 0 ? [HUNDREDS[hundreds] ?? ''] : [];
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)] ?? '');
    if (rest % 10 > 0) words.push(DIGITS[rest % 10] ?? '');
  } else if (rest >= 10) {
    words.push(TEENS[rest - 10] ?? '');
  } else if (rest > 0) {
    words.push(DIGITS[rest] ?? '');
  }
  return words;
}

export function cardinal(value: number): string {
  if (value === 0) return 'zero';
  const words: string[] = [];
  let divisor = 1_000_000_000;
  for (let scale = SCALES.length - 1; scale >= 0; scale -= 1) {
    const group = Math.floor(value / divisor) % 1000;
    const forms = SCALES[scale];
    if (group > 0 && forms) {
      words.push(...(group === 1 ? [] : belowThousand(group)), pick(group, forms));
    }
    divisor /= 1000;
  }
  words.push(...belowThousand(value % 1000));
  return words.join(' ');
}

export function cardinalFeminine(value: number): string {
  return value === 1 ? 'jedna' : cardinal(value).replace(/dwa$/u, 'dwie');
}

export function cardinalNeuter(value: number): string {
  return value === 1 ? 'jedno' : cardinal(value);
}

/** A count agreeing with the noun that follows it: "dwie godziny", "jedno okno". */
export function cardinalBefore(value: number, noun: string): string {
  if (FEMININE_NOUN.test(noun)) return cardinalFeminine(value);
  return NEUTER_NOUN.test(noun) ? cardinalNeuter(value) : cardinal(value);
}

function inflect(word: string, form: OrdinalForm): string {
  const [hard, soft] = ORDINAL_ENDINGS[form];
  if (word === 'trzeci') return `trzec${form === 'nomF' || form === 'insF' ? `i${soft}` : soft}`;
  return `${word.slice(0, -1)}${word.endsWith('i') ? soft : hard}`;
}

/** The words of an ordinal below a hundred, or the single exact-hundred word. */
function ordinalBelowHundred(value: number): string[] {
  if (value >= 20) {
    const tens = ORDINAL_TENS[Math.floor(value / 10)] ?? '';
    return value % 10 > 0 ? [tens, ORDINAL_DIGITS[value % 10] ?? ''] : [tens];
  }
  return [value >= 10 ? ORDINAL_TEENS[value - 10] ?? '' : ORDINAL_DIGITS[value] ?? ''];
}

/** Only the last two words of a Polish ordinal decline: "dwa tysiące dwudziestego szóstego". */
export function ordinal(value: number, form: OrdinalForm): string {
  const thousands = Math.floor(value / 1000);
  const hundreds = Math.floor(value % 1000 / 100);
  const rest = value % 100;
  if (thousands > ORDINAL_THOUSANDS.length - 1) return cardinal(value);
  if (value > 0 && value % 1000 === 0) return inflect(ORDINAL_THOUSANDS[thousands] ?? '', form);
  const fixed = thousands > 0 ? [cardinal(thousands * 1000)] : [];
  if (rest === 0 && hundreds > 0) return [...fixed, inflect(ORDINAL_HUNDREDS[hundreds] ?? '', form)].join(' ');
  if (hundreds > 0) fixed.push(HUNDREDS[hundreds] ?? '');
  return [...fixed, ...ordinalBelowHundred(rest).map((word) => inflect(word, form))].join(' ');
}

/** The ordinal form a nominative noun asks for: "druga wersja", "drugie miejsce". */
export function ordinalFormFor(noun: string): OrdinalForm {
  if (/a$/iu.test(noun)) return 'nomF';
  return /(?:e|o|ę|um)$/iu.test(noun) ? 'nomN' : 'nomM';
}

/** "półtora", "półtorej", "dwa i pół": the way Polish says x,5. */
export function andAHalf(whole: number, noun: string, feminine: boolean): string {
  if (whole === 0) return `pół ${noun}`;
  if (whole === 1) return `${feminine ? 'półtorej' : 'półtora'} ${noun}`;
  return `${feminine ? cardinalFeminine(whole) : cardinal(whole)} i pół ${noun}`;
}
