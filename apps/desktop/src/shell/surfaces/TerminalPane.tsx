import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
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

  // Mount xterm once. The surface hook (below) feeds it data + receives input.
  const surface = useSurface(workspaceId, 'terminal', {
    onSnapshot: (snap) => {
      const s = snap as { data?: string } | undefined;
      if (s?.data && termRef.current) termRef.current.write(s.data);
    },
    onData: (payload) => {
      const p = payload as { type?: string; data?: string };
      if (p?.type === 'data' && typeof p.data === 'string') termRef.current?.write(p.data);
      else if (p?.type === 'exit') termRef.current?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
    },
  });
  // Stable ref so the mount effect can reach the latest input/resize senders.
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#0b0f17', foreground: '#d6deeb' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Only fit once the host actually has layout. The rail slides open with a
    // width transition, so an eager fit() on mount measures a near-zero width
    // and locks xterm (and, via onResize below, the PTY) to ~1–2 columns —
    // which is what made the output wrap after every character. Skipping the
    // fit until there's real width keeps xterm at its 80-col default until the
    // ResizeObserver can size it correctly.
    const doFit = (): void => {
      if (host.clientWidth < 8 || host.clientHeight < 8) return;
      try {
        fit.fit();
      } catch {
        /* element detached mid-resize */
      }
    };

    const dataSub = term.onData((d) => surfaceRef.current.input({ type: 'data', data: d }));
    const resizeSub = term.onResize(({ cols, rows }) => surfaceRef.current.resize({ cols, rows }));
    const ro = new ResizeObserver(doFit);
    ro.observe(host);
    // First fit after layout/paint (and again next frame — the open transition
    // may still be animating on the first).
    const raf1 = requestAnimationFrame(() => {
      doFit();
      requestAnimationFrame(doFit);
    });

    return () => {
      cancelAnimationFrame(raf1);
      dataSub.dispose();
      resizeSub.dispose();
      ro.disconnect();
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
    if (host && host.clientWidth >= 8 && host.clientHeight >= 8) {
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {surface.error && (
        <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--color-danger, #f87171)' }}>
          Terminal unavailable: {surface.error}
        </div>
      )}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, padding: 8, background: '#0b0f17' }} />
    </div>
  );
}
