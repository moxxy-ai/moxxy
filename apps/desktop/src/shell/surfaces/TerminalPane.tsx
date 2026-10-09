import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { terminalTheme } from './terminal-theme';
import { terminalWelcome } from './terminal-welcome';
import { useSurface } from './useSurface';

/**
 * The embedded terminal pane: an xterm.js view of the runner's shared PTY. The
 * agent's `terminal` tool writes to the SAME session, so its commands appear
 * here live; the user can type too (keystrokes → `surface.input`). Output frames
 * (`{ type: 'data', data }`) are written to xterm; the snapshot replays
 * scrollback on (re)mount.
 */
export function TerminalPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Set when the runner can't start a real PTY (node-pty unavailable / failed):
  // the piped fallback isn't an interactive terminal, so we show why instead of
  // letting the box silently ignore keystrokes.
  const [degraded, setDegraded] = useState<string | null>(null);

  // Mount xterm once. The surface hook (below) feeds it data + receives input.
  const surface = useSurface(workspaceId, 'terminal', {
    onSnapshot: (snap) => {
      const s = snap as { data?: string; backend?: string; ptyError?: string | null } | undefined;
      if (s?.data && termRef.current) termRef.current.write(s.data);
      if (s?.backend === 'pipe') {
        setDegraded(
          s.ptyError
            ? `The PTY backend failed to start (${s.ptyError}).`
            : 'A real PTY backend (node-pty) is not available.',
        );
      }
    },
    onData: (payload) => {
      const p = payload as { type?: string; data?: string; text?: string };
      if (p?.type === 'data' && typeof p.data === 'string') termRef.current?.write(p.data);
      else if (p?.type === 'exit') termRef.current?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      else if (p?.type === 'status' && typeof p.text === 'string') setDegraded(p.text);
    },
  });
  // Stable ref so the mount effect can reach the latest input/resize senders.
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

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
    term.write(terminalWelcome());
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

    const dataSub = term.onData((d) => surfaceRef.current.input({ type: 'data', data: d }));
    const resizeSub = term.onResize(({ cols, rows }) => surfaceRef.current.resize({ cols, rows }));
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
  }, []);

  // Once the surface is attached, fit to the real size, push it to the PTY, and
  // focus so the user can type immediately.
  useEffect(() => {
    if (!surface.ready) return;
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
    surface.resize({ cols: term.cols, rows: term.rows });
    term.focus();
  }, [surface.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="term-pane">
      {(surface.error || degraded) && (
        <div className="term-pane__error" role="status">
          Terminal unavailable: {surface.error ?? degraded}
        </div>
      )}
      <div className="term-pane__host" onMouseDown={() => termRef.current?.focus()}>
        <div ref={hostRef} className="term-pane__mount" />
      </div>
    </div>
  );
}
