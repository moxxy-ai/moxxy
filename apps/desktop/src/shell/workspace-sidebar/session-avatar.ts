export interface SessionAvatarSpec {
  /** Hue in degrees. The stylesheet picks lightness and chroma per theme. */
  readonly hue: number;
  readonly glyph: string;
}

/** Twelve hues, 30° apart: enough to tell neighbours apart, few enough to read as one palette. */
const HUE_STEPS = 12;
const NEUTRAL_GLYPH = '#';

/** FNV-1a. Any stable spread would do; this one needs no dependency. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The avatar a run draws in the list. The colour comes from the id, so it
 * survives a rename; the letter comes from the name, so it follows one.
 */
export function sessionAvatar(id: string, name: string): SessionAvatarSpec {
  const first = name.match(/[\p{L}\p{N}]/u);
  return {
    hue: (hash(id) % HUE_STEPS) * (360 / HUE_STEPS),
    glyph: first ? first[0].toLocaleUpperCase() : NEUTRAL_GLYPH,
  };
}
