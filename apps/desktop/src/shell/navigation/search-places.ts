import type { Place } from './places';

/** Lower case, no accents, and every run of punctuation as one space. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

const startsAWord = (text: string, query: string): boolean => ` ${text}`.includes(` ${query}`);

/**
 * How well a place answers the query, lower being better, or null when it does
 * not: its name, then another word for it, then a name that starts with the
 * query or carries it as a word, then a mention anywhere.
 */
function rank(place: Place, query: string, words: ReadonlyArray<string>): number | null {
  const label = plain(place.label);
  const keywords = place.keywords.map(plain);
  if (label === query) return 0;
  if (keywords.includes(query)) return 1;
  if (label.startsWith(query)) return 2;
  if (startsAWord(label, query)) return 3;
  if (keywords.some((keyword) => startsAWord(keyword, query))) return 4;
  const everything = [label, ...keywords, plain(place.trail ?? '')].join(' ');
  return words.every((word) => everything.includes(word)) ? 5 : null;
}

/**
 * The places a query asks for, best first. Before anything is typed that is
 * the views themselves; what is inside them is found, not listed.
 */
export function searchPlaces<T extends Place>(places: ReadonlyArray<T>, query: string): T[] {
  const asked = plain(query);
  if (asked === '') return places.filter((place) => place.top === true);
  const words = asked.split(' ');
  return places
    .map((place, order) => ({ place, order, rank: rank(place, asked, words) }))
    .filter((entry): entry is { place: T; order: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.place);
}
