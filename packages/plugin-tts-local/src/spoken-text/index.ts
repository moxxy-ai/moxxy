/**
 * Rewrites written text the way it is said, just before it reaches the local
 * voice. Supertonic reads the characters it is given and has no rules for
 * numbers, so "1500 zł" has to arrive as "tysiąc pięćset złotych". Chat text
 * is never touched: this runs on the copy that is spoken.
 */

import { englishSpeech } from './english.js';
import { polishSpeech } from './polish.js';
import { dropTags, tidy } from './shared.js';

export function normalizeForSpeech(text: string, lang: string): string {
  if (lang === 'pl') return polishSpeech(text);
  if (lang === 'en') return englishSpeech(text);
  return tidy(dropTags(text));
}
