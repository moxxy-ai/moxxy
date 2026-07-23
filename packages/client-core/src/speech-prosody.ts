export interface SpeechProsody {
  /** Piper speaking-rate multiplier. Kept deliberately close to natural speed. */
  readonly rate: number;
  /** Extra silence after this generated clip before the queue advances. */
  readonly pauseAfterMs: number;
}

const MIN_RATE = 0.94;
const MAX_RATE = 1.08;
const LONG_SENTENCE_WORDS = 16;
const WORD_RE = /\p{L}+(?:[-'’]\p{L}+)*/gu;
const CLOSING_PUNCTUATION_RE = /["'”’\])]+$/u;

/**
 * Derive a subtle, deterministic cadence from one speakable chunk. This is
 * intentionally rule-based: equal input always sounds equal, while punctuation
 * and sentence length still produce the small tempo/pause changes people use in
 * conversation. Piper has no semantic emotion control, so the planner stays
 * within conservative bounds that do not distort its voices.
 */
export function planSpeechProsody(text: string): SpeechProsody {
  const normalized = text.trim().replace(CLOSING_PUNCTUATION_RE, '');
  const words = normalized.match(WORD_RE) ?? [];

  let rate = 1;
  let pauseAfterMs = 100;

  if (/(?:\.\.\.|…)$/u.test(normalized)) {
    rate = MIN_RATE;
    pauseAfterMs = 220;
  } else if (/!$/u.test(normalized)) {
    rate = 1.06;
    pauseAfterMs = 70;
  } else if (/\?$/u.test(normalized)) {
    rate = 1.02;
    pauseAfterMs = 150;
  } else if (/[;:]$/u.test(normalized)) {
    rate = 0.98;
    pauseAfterMs = 55;
  } else if (!/\.$/u.test(normalized)) {
    rate = 0.99;
    pauseAfterMs = 45;
  } else if (words.length <= 3) {
    rate = 1.03;
  }

  if (words.length >= LONG_SENTENCE_WORDS && rate > MIN_RATE) {
    rate -= 0.03;
  }

  return Object.freeze({
    rate: roundRate(Math.min(MAX_RATE, Math.max(MIN_RATE, rate))),
    pauseAfterMs,
  });
}

function roundRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}
