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
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#0b0f17', foreground: '#d6deeb' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const dataSub = term.onData((d) => surfaceRef.current.input({ type: 'data', data: d }));
    const resizeSub = term.onResize(({ cols, rows }) =>
      surfaceRef.current.resize({ cols, rows }),
    );
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* element detached mid-resize */
      }
    });
    ro.observe(hostRef.current);

    return () => {
      dataSub.dispose();
      resizeSub.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Push the initial size once the surface is ready.
  useEffect(() => {
    if (surface.ready && termRef.current) {
      surface.resize({ cols: termRef.current.cols, rows: termRef.current.rows });
    }
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
