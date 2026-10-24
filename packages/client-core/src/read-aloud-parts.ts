import { toSpeakableText } from './speech.js';
import { IncrementalSpeechSegmenter } from './streaming-speech.js';

/**
 * Split a message for a synthesizer that takes it whole (Gemini TTS): as few
 * parts as possible, each cut between sentences and at most `maxChars` of
 * spoken text. Code blocks count as the few words read in their place.
 */
export function splitForReadAloud(markdown: string, maxChars: number): string[] {
  const segmenter = new IncrementalSpeechSegmenter({ maxChars });
  const parts: string[] = [];
  let current = '';
  let spoken = 0;
  for (const sentence of [...segmenter.push(markdown), ...segmenter.flush()]) {
    const length = toSpeakableText(sentence).length;
    if (current && spoken + 1 + length > maxChars) {
      parts.push(current);
      current = '';
      spoken = 0;
    }
    // A new line, not a space, so headings and list items keep their markup.
    current = current ? `${current}\n${sentence}` : sentence;
    spoken += (spoken ? 1 : 0) + length;
  }
  if (current) parts.push(current);
  return parts;
}
