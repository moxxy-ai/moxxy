/**
 * The moxxy design tokens — one framework-neutral source of truth for colour,
 * typography, geometry, spacing, frame heights, and motion. The desktop
 * renderer projects these to CSS custom properties (see `./css-vars`); the
 * React Native app consumes the same object directly in `StyleSheet.create`.
 * Values mirror the desktop's `styles.css` `:root` block, and the parity test
 * in `./css-vars.test.ts` keeps the two declarations locked together.
 *
 * ## The design language: Harness
 *
 * An agent that works unattended for an hour is not holding a conversation, it
 * is executing a run, and the person watching it is supervising an autopilot.
 * So the app is drawn as an instrument panel built from two interlaced straps —
 * the mark's own construction — and the palette follows glass-cockpit
 * discipline rather than brand decoration:
 *
 *   - The chrome is ACHROMATIC. Panel greys carry a blue-green bias (anodised
 *     aluminium under bench light), never a neutral grey and never a warm cream.
 *   - Colour appears on DATA, and each hue means exactly one thing:
 *     `primary` (magenta) = commanded by the human, `green` = nominal,
 *     `amber` = needs attention, `red` = failed, `reference` (cyan) = reference
 *     data. A hue is information here, so nothing else may borrow it.
 *   - Structure comes from hairlines (`cardBorder`), not from elevation. There
 *     are no gradients: a gradient reads as decoration, and this palette spends
 *     its whole colour budget on meaning.
 *
 * Numbers (radii, spacing, type sizes, frame heights) are plain numbers — CSS
 * appends `px`, RN wants the bare number. Durations are CSS time strings.
 */

export const tokens = {
  color: {
    /* Panel: the ground the whole instrument sits on. */
    appBg: '#e7eaeb',
    /* Bay: the working surface a run is drawn on. */
    mainBg: '#ffffff',
    /* Resting surface for controls that sit ON a card or column. */
    surface: '#ffffff',
    /* Sunk: recessed fill for inputs and wells, a step BELOW the surface. */
    inputSoft: '#f1f3f4',
    cardBg: '#ffffff',
    /* Seam: the hairline that carries all structure in this language. */
    cardBorder: '#dfe4e6',
    cardBorderStrong: '#c7cfd2',
    /* Ink, in the panel's own blue-green family rather than a neutral black. */
    text: '#0b0f12',
    textMuted: '#4a5a64',
    textDim: '#66757e',
    /* The icon rail is the panel ground; the index column beside it is the bay,
     * so the two columns register against each other without a heavy border. */
    sidebarBg: '#e7eaeb',
    sidebarBgHover: '#dde2e3',
    /* The active row carries the commanded wash. */
    sidebarBgActive: '#fbeaf2',
    sidebarText: '#0b0f12',
    sidebarTextDim: '#66757e',
    sidebarBorder: '#dfe4e6',
    /* Commanded — the ONE accent, and it is not decoration: it marks what the
     * human ordered (their turn in the trace, the send action, the active rail
     * item, focus). On paper the accent must be DEEP enough to carry a white
     * label, which is why this is the mulberry stop and not flat magenta. */
    primary: '#c21e6b',
    primaryStrong: '#9d1355',
    primarySoft: '#fbeaf2',
    /* Text/icon colour that sits ON a commanded fill. Not `#fff` at the call
     * site: the dark theme's accent is light and needs an ink label instead,
     * and a hard-coded white would silently fail there. */
    onPrimary: '#ffffff',
    send: '#c21e6b',
    /* One accent means the secondary stays inside it rather than introducing a
     * second brand hue that would compete with the semantic set. */
    accent: '#c21e6b',
    accentStrong: '#9d1355',
    /* Semantic and categorical hues. These are information, not brand: a
     * workflow step kind is identified by its hue, and green/amber/red mean
     * nominal/attention/failure exactly as they do on an instrument panel. */
    purple: '#575e8c',
    green: '#0e7a5a',
    amber: '#9a6208',
    /* `pink` was never categorical; it stays an alias of the accent. */
    pink: '#c21e6b',
    red: '#c0303a',
    /* Reference data: links, cited paths, telemetry that is neither a state nor
     * a command. The fifth and last hue in the system. */
    reference: '#0e7490',
    /* The scrim under a true overlay. Ink-tinted, never a neutral black:
     * a grey veil over an anodised panel reads as a screenshot of the app. */
    overlay: 'rgba(28, 34, 38, 0.34)',
  },
  shadow: {
    /* Structure comes from hairlines, so a shadow only exists to lift a true
     * overlay off the panel: one hard near-contact line plus a wide, very
     * negatively-spread pool. Nothing in the flat UI casts a shadow. */
    card: '0 1px 0 rgba(255, 255, 255, 0.9), 0 24px 48px -22px rgba(11, 15, 18, 0.28)',
  },
  font: {
    /* Chrome, labels, paths, tool names, and every number are set in the
     * machine's own face: engineered lettering with tabular figures, so columns
     * of data actually line up. This is the app's DEFAULT face. */
    chrome:
      "'IBM Plex Mono', 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    /* The one proportional voice: prose written or read by a human.
     *
     * This started as a screen serif, on the argument that a long transcript is
     * long-form reading. In the app it was wrong — a serif reads as a document
     * about the work rather than as someone talking to you, and this is a
     * conversation with an agent. A warm humanist sans is friendlier at the same
     * size and keeps the contrast that matters: the machine speaks in engineered
     * mono, the human-readable half speaks in a face built for people.
     *
     * Avenir Next leads because it is geometric-humanist and genuinely warm; the
     * fallbacks are each platform's own text face (never Inter, which is both the
     * face this redesign moved off and a neo-grotesque, not a friendly one).
     * Nothing outside prose may use this. */
    prose:
      "'Avenir Next', -apple-system, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    /* Code blocks. Same family as the chrome by design — the chrome IS the code
     * face in this language — but kept as its own token so a later divergence
     * (a wider face for code, say) does not have to touch the chrome. */
    mono: "'IBM Plex Mono', 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  },
  radius: {
    /* Sharp geometry, one step per level of nesting: a readout you cannot press
     * (`tag`), a control or a row (`chip`), a panel one of those sits in
     * (`block`), a container that holds panels (`card`). The structural surfaces
     * — the bar, the columns, the composer, the bench — are SQUARE; rounding
     * them would make the frame read as a stack of cards. The full pill survives
     * only where the SHAPE carries information (a state LED, a run-state pill),
     * never as a default. */
    tag: 3,
    chip: 4,
    block: 5,
    card: 6,
    pill: 9999,
  },
  /* Spacing scale, 4px grid. Keyed by its own pixel value so a reader never has
   * to decode a t-shirt size: `--space-12` is 12px and nothing else. */
  space: {
    2: 2,
    4: 4,
    6: 6,
    8: 8,
    12: 12,
    16: 16,
    20: 20,
    24: 24,
    32: 32,
    40: 40,
    56: 56,
  },
  /* Type scale. Two uppercase tracked-out sizes, because the design uses two:
   * `micro` names a GROUP inside a list (an index group, a palette section, a
   * KPI key), `label` names the SECTION that list belongs to. Collapsing them
   * made every group header read one step too loud. `prose` is the only size the
   * prose face is ever set at; everything else is chrome. */
  type: {
    micro: 9.5,
    label: 10.5,
    meta: 11.5,
    row: 12.5,
    ui: 13,
    prose: 14.5,
    section: 19,
    display: 26,
  },
  /* Frame heights. Every value divides by 2 so nothing lands on a half pixel,
   * and `bar` is shared by the instrument bar and the index head so the two
   * read as ONE horizontal strap crossing under the rail. */
  frame: {
    titlebar: 30,
    bar: 44,
    row: 30,
    tool: 26,
    control: 26,
    rail: 52,
    index: 244,
    bench: 372,
  },
  /* Three durations and one signature. No springs, no parallax. The mark's
   * quarter turn is the only looping animation in the app: the mark is
   * symmetric under 90 degrees, so the loop closes with no visible seam. */
  motion: {
    press: '90ms',
    shift: '140ms',
    overlay: '220ms',
    markTurn: '3400ms',
  },
} as const;

export type Tokens = typeof tokens;

/** Structural widening of {@link Tokens} — same keys, plain `string` /
 *  `number` leaves — so alternate palettes (dark) can hold different values
 *  while staying shape-compatible with everything that reads `tokens`. */
type Widen<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends number ? number : Widen<T[K]>;
};
export type ThemeTokens = Widen<Tokens>;

/**
 * The DESIGNED dark palette — not an inversion. Ink is the ground, and the
 * lightness ordering matches light's intent (rail/panel < bay < card < raised
 * surface), so the columns keep registering against each other.
 *
 * The accent does NOT survive the flip unchanged, and that is the one thing to
 * know about this palette: light's commanded stop is deep because it must carry
 * a white label on paper, and the same mulberry on near-black is nearly
 * invisible. On ink the accent lifts to luminous magenta — which then cannot
 * carry white either, so `onPrimary` flips to ink. Same reason the brand ships
 * a `-dark` mark rather than recolouring the light one with a CSS filter.
 *
 * Shape-frozen against {@link tokens} (identical keys throughout) — mobile's
 * theme map and the CSS-var generator consume both interchangeably.
 */
export const darkTokens: ThemeTokens = {
  color: {
    appBg: '#0b0f12',
    mainBg: '#101519',
    surface: '#1c242a',
    inputSoft: '#0a0e11' /* sunk inputs recess below the bay they sit in */,
    cardBg: '#151b20',
    cardBorder: '#212a31',
    cardBorderStrong: '#2e3941',
    text: '#e4ebef',
    textMuted: '#93a2ab',
    textDim: '#77868f',
    sidebarBg: '#0b0f12',
    sidebarBgHover: '#161c22',
    sidebarBgActive: '#24101b' /* the commanded wash, at ink lightness */,
    sidebarText: '#e4ebef',
    sidebarTextDim: '#77868f',
    sidebarBorder: '#212a31',
    /* Luminous on ink, and therefore ink-labelled — see the note above. */
    primary: '#f4408f',
    primaryStrong: '#ff63a8',
    primarySoft: '#24101b',
    onPrimary: '#0b0f12',
    send: '#f4408f',
    accent: '#f4408f',
    accentStrong: '#ff63a8',
    purple: '#8e9ac8',
    green: '#3fbf8f',
    amber: '#e8a33d',
    pink: '#f4408f',
    red: '#f2545b',
    reference: '#4fc3d9',
    overlay: 'rgba(4, 6, 8, 0.68)',
  },
  shadow: {
    /* An ink-tinted shadow reads as nothing on a dark ground, so the overlay
     * pool goes near-black at high alpha and the contact line inverts to a
     * faint lit seam along the overlay's top edge. */
    card: '0 1px 0 rgba(255, 255, 255, 0.04), 0 24px 48px -20px rgba(0, 0, 0, 0.8)',
  },
  font: { ...tokens.font },
  radius: { ...tokens.radius },
  space: { ...tokens.space },
  type: { ...tokens.type },
  frame: { ...tokens.frame },
  motion: { ...tokens.motion },
};
