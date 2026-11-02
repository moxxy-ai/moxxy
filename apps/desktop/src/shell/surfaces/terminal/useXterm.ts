import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { terminalTheme } from '../terminal-theme';
import { terminalWelcome, type TerminalOwner } from '../terminal-welcome';

/** Where an xterm view sends what is typed and its size, and whether it is attached yet. */
export interface XtermLink {
  readonly ready: boolean;
  readonly input: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
}

export interface Xterm {
  /** The box xterm mounts in and measures. */
  readonly hostRef: RefObject<HTMLDivElement>;
  readonly write: (text: string) => void;
  readonly focus: () => void;
}

/**
 * An xterm.js view, mounted once into `hostRef`: themed from the app's palette
 * (again on every theme change), fitted to its box, its keys and size sent
 * through `link`. Once `link` is ready it is fitted, its size pushed and focused.
 */
export function useXterm(link: XtermLink, owner: TerminalOwner): Xterm {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Stable ref so the mount effect can reach the latest input/resize senders.
  const linkRef = useRef(link);
  linkRef.current = link;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // xterm paints to a canvas, so it cannot resolve `var()`: it is handed the
    // palette's values, and handed them again whenever the theme changes.
    const css = getComputedStyle(document.documentElement);
    const readTheme = (): ReturnType<typeof terminalTheme> =>
      terminalTheme((name) => getComputedStyle(document.documentElement).getPropertyValue(name));
    const term = new Terminal({
      fontFamily: css.getPropertyValue('--font-mono').trim() || 'ui-monospace, Menlo, monospace',
      // A NUMBER, not a CSS value: xterm measures glyphs itself and will not
      // resolve a token here (a blanket sweep of the renderer's font sizes broke
      // this once). Kept in step with --type-row by hand.
      fontSize: 12.5,
      cursorBlink: true,
      theme: readTheme(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    // Above the scrollback the snapshot replays, so it stays the top of the terminal.
    term.write(terminalWelcome(owner));
    termRef.current = term;
    fitRef.current = fit;

    // Fit only when the pane has a real width, and debounce to a single rAF.
    // Two traps this avoids: (1) the rail used to slide open, so an eager fit
    // measured a near-zero width and locked xterm — and, via onResize, the PTY —
    // to ~2 columns (every char wrapped); the 120px floor means we never fit at
    // a transient sliver. (2) fit() nudges layout, which can re-enter a
    // synchronous ResizeObserver and make the browser drop the *final*
    // full-width notification ("ResizeObserver loop" throttling) — leaving it
    // stuck small. Coalescing to one rAF breaks that re-entry so the last fit
    // always lands.
    let rafId = 0;
    const scheduleFit = (): void => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (host.clientWidth < 120 || host.clientHeight < 40) return;
        try {
          fit.fit();
        } catch {
          /* element detached mid-resize */
        }
      });
    };

    const dataSub = term.onData((d) => linkRef.current.input(d));
    const resizeSub = term.onResize(({ cols, rows }) => linkRef.current.resize(cols, rows));
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(host);
    scheduleFit();

    // xterm paints to a canvas, so it is handed the palette again whenever the
    // theme controller flips `<html data-theme>` (it does so for the OS scheme too).
    const themeAttr = new MutationObserver(() => {
      term.options.theme = readTheme();
    });
    themeAttr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      dataSub.dispose();
      resizeSub.dispose();
      ro.disconnect();
      themeAttr.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // A view is mounted for one terminal (its pane is keyed by it): `owner` never changes under it.
  }, []);

  // Once attached, fit to the real size, push it, and focus so the user can type immediately.
  useEffect(() => {
    if (!link.ready) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const host = hostRef.current;
    if (host && host.clientWidth >= 120 && host.clientHeight >= 40) {
      try {
        fit.fit();
      } catch {
        /* detached */
      }
    }
    linkRef.current.resize(term.cols, term.rows);
    term.focus();
  }, [link.ready]);

  const write = useCallback((text: string): void => termRef.current?.write(text), []);
  const focus = useCallback((): void => termRef.current?.focus(), []);
  return { hostRef, write, focus };
}
