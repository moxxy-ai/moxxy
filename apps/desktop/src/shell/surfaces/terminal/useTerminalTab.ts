import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';

export interface TerminalTabControls {
  /** Attached: what the tab printed so far is written, its output streams. */
  readonly ready: boolean;
  /** Why the tab cannot be used (gone, or no real terminal). */
  readonly error: string | null;
  readonly input: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
}

/**
 * One of the project's own shells (`terminal.*`): writes what it printed
 * before the pane attached, then its live output, to `sink`. Output that
 * arrives while attaching is dropped: the attach snapshot already holds it.
 */
export function useTerminalTab(tabId: string, sink: { readonly write: (text: string) => void }): TerminalTabControls {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  useEffect(() => {
    setReady(false);
    setError(null);
    let attached = false;
    let disposed = false;
    const off = api().subscribe('terminal.data', (payload) => {
      if (attached && !disposed && payload.tabId === tabId) sinkRef.current.write(payload.data);
    });
    void api()
      .invoke('terminal.attach', { tabId })
      .then((snapshot) => {
        if (disposed) return;
        if (!snapshot) {
          setError('This terminal was closed.');
          return;
        }
        if (snapshot.data) sinkRef.current.write(snapshot.data);
        if (snapshot.backend === 'pipe') {
          setError(
            snapshot.ptyError
              ? `The PTY backend failed to start (${snapshot.ptyError}).`
              : 'A real PTY backend (node-pty) is not available.',
          );
        }
        attached = true;
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!disposed) setError(toErrorMessage(err));
      });
    return () => {
      disposed = true;
      off();
    };
  }, [tabId]);

  const input = useCallback(
    (data: string): void => void api().invoke('terminal.input', { tabId, data }).catch(() => undefined),
    [tabId],
  );
  const resize = useCallback(
    (cols: number, rows: number): void => void api().invoke('terminal.resize', { tabId, cols, rows }).catch(() => undefined),
    [tabId],
  );
  return { ready, error, input, resize };
}
