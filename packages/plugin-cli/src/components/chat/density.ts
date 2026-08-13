/**
 * How much vertical room the transcript spends between entries.
 *
 * `comfortable` (the default) keeps one blank line between blocks, which reads
 * well on a full-screen terminal. `compact` drops it, which is what a 24-row
 * split pane or a tmux strip actually needs: on those, half the screen is
 * separator.
 *
 * Read from the environment rather than config for the same reason the theme
 * and hint preferences are: this package deliberately does not load config, so
 * the CLI resolves the preference at boot and passes it down this channel.
 *
 * Evaluated per call rather than cached at import so a test can flip it, and
 * because it is a property read on a component render, not a hot loop.
 */
export type TuiDensity = 'comfortable' | 'compact';

export function tuiDensity(): TuiDensity {
  return process.env.MOXXY_TUI_DENSITY === 'compact' ? 'compact' : 'comfortable';
}

/** Rows of separation between two transcript blocks. */
export function blockGap(): 0 | 1 {
  return tuiDensity() === 'compact' ? 0 : 1;
}
