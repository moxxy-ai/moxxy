/** English numbers in words. Hyphens and "and" are left out: the voice pauses on them. */

export const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] as const;
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;
const SCALES = ['thousand', 'million', 'billion'] as const;
const IRREGULAR_ORDINALS: Readonly<Record<string, string>> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

function belowHundred(value: number): string {
  if (value >= 20) {
    const tens = TENS[Math.floor(value / 10)] ?? '';
    return value % 10 > 0 ? `${tens} ${DIGITS[value % 10] ?? ''}` : tens;
  }
  return value >= 10 ? TEENS[value - 10] ?? '' : DIGITS[value] ?? '';
}

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const words = hundreds > 0 ? [`${DIGITS[hundreds] ?? ''} hundred`] : [];
  if (rest > 0) words.push(belowHundred(rest));
  return words.join(' ');
}

export function cardinal(value: number): string {
  if (value === 0) return 'zero';
  const words: string[] = [];
  let divisor = 1_000_000_000;
  for (let scale = SCALES.length - 1; scale >= 0; scale -= 1) {
    const group = Math.floor(value / divisor) % 1000;
    if (group > 0) words.push(`${belowThousand(group)} ${SCALES[scale] ?? ''}`);
    divisor /= 1000;
  }
  if (value % 1000 > 0) words.push(belowThousand(value % 1000));
  return words.join(' ');
}

export function ordinal(value: number): string {
  const words = cardinal(value).split(' ');
  const last = words.pop() ?? '';
  const irregular = IRREGULAR_ORDINALS[last];
  const spoken = irregular ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, spoken].join(' ');
}

/** Years go in pairs, except around 2000: "twenty twenty six", "two thousand five". */
export function year(value: number): string {
  const century = Math.floor(value / 100);
  const rest = value % 100;
  if (value >= 2000 && value < 2010) return cardinal(value);
  if (rest === 0) return value % 1000 === 0 ? cardinal(value) : `${belowHundred(century)} hundred`;
  return `${belowHundred(century)} ${rest < 10 ? `oh ${DIGITS[rest] ?? ''}` : belowHundred(rest)}`;
}
