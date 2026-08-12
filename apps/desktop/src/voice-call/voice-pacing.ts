import type { VoiceCallPhase } from '@moxxy/client-core';

/**
 * Timing and level shared by everything that reacts to a voice.
 *
 * These outlived the full-screen hologram they were written for: the presence
 * rail's pulse and the Focus widget's spectrogram both still need to know how
 * loud the voice is and how often it is worth asking.
 */

/** Shortest gap between painted frames, for anything still painting per frame. */
const PAINT_FRAME_MS = 1_000 / 30 - 1;

/**
 * Shortest gap between voice-level samples.
 *
 * The pulse is a glow breathing with someone's voice, not a waveform — a
 * fifteenth of a second of latency is invisible on it, and on a 120Hz display
 * sampling every frame would cost eight times the work for nothing.
 */
export const VOICE_PULSE_FRAME_MS = 1_000 / 15 - 1;

/**
 * Whether this animation-frame callback should do its work.
 *
 * `null` (a fresh loop, a resize, a return from hidden) always runs, and a
 * timestamp that moves backwards runs too rather than stalling until the clock
 * catches up.
 */
export function shouldPaintVoiceFrame(
  lastPaint: number | null,
  timestamp: number,
  minGapMs: number = PAINT_FRAME_MS,
): boolean {
  if (lastPaint === null || !Number.isFinite(lastPaint) || !Number.isFinite(timestamp)) return true;
  const elapsed = timestamp - lastPaint;
  return elapsed < 0 || elapsed >= minGapMs;
}

/** How brightly the visuals should burn in a given phase, `0` … `1`. */
export function resolveVoiceEnergy(phase: VoiceCallPhase, audioLevel: number): number {
  const level = Number.isFinite(audioLevel) ? Math.max(0, Math.min(1, audioLevel)) : 0;
  if (phase === 'listening' || phase === 'speaking') return Math.max(0.18, level);
  if (phase === 'thinking' || phase === 'working' || phase === 'synthesizing') return 0.34;
  if (phase === 'transcribing' || phase === 'checking' || phase === 'arming') return 0.24;
  if (phase === 'error') return 0.16;
  if (phase === 'paused') return 0.08;
  return 0.14;
}
