import { useState } from 'react';
import { TerminalTabStrip } from './terminal/TerminalTabStrip';
import { useTerminalTab } from './terminal/useTerminalTab';
import { AGENT_TAB, useTerminalTabs } from './terminal/useTerminalTabs';
import { useXterm, type Xterm } from './terminal/useXterm';
import { useSurface } from './useSurface';

/**
 * The embedded terminal pane, in tabs. The Agent tab is an xterm.js view of
 * the runner's shared PTY: the agent's `terminal` tool writes to the SAME
 * session, so its commands appear there live, and the user can type too. The
 * other tabs are the project's own shells (main-owned, shared by the
 * project's chats); closing one stops everything started from it.
 */
export function TerminalPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const tabs = useTerminalTabs(workspaceId);
  return (
    <div className="term-pane">
      <TerminalTabStrip
        tabs={tabs.tabs}
        active={tabs.active}
        onSelect={tabs.select}
        onOpen={() => void tabs.open().catch(() => undefined)}
        onClose={(tabId) => void tabs.close(tabId).catch(() => undefined)}
      />
      {tabs.active === AGENT_TAB ? (
        <AgentTerminal key={workspaceId ?? ''} workspaceId={workspaceId} />
      ) : (
        <TabTerminal key={tabs.active} tabId={tabs.active} />
      )}
    </div>
  );
}

/** The agent's terminal: output frames (`{ type: 'data', data }`) are written to xterm; the snapshot replays scrollback on (re)mount. */
function AgentTerminal({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  // Set when the runner can't start a real PTY (node-pty unavailable / failed):
  // the piped fallback isn't an interactive terminal, so we show why instead of
  // letting the box silently ignore keystrokes.
  const [degraded, setDegraded] = useState<string | null>(null);
  const surface = useSurface(workspaceId, 'terminal', {
    onSnapshot: (snap) => {
      const s = snap as { data?: string; backend?: string; ptyError?: string | null } | undefined;
      if (s?.data) xterm.write(s.data);
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
      if (p?.type === 'data' && typeof p.data === 'string') xterm.write(p.data);
      else if (p?.type === 'exit') xterm.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      else if (p?.type === 'status' && typeof p.text === 'string') setDegraded(p.text);
    },
  });
  const xterm = useXterm({
    ready: surface.ready,
    input: (data) => surface.input({ type: 'data', data }),
    resize: (cols, rows) => surface.resize({ cols, rows }),
  }, 'agent');
  return <XtermBox xterm={xterm} error={surface.error ?? degraded} />;
}

/** One of the project's own shells. */
function TabTerminal({ tabId }: { readonly tabId: string }): JSX.Element {
  const tab = useTerminalTab(tabId, { write: (text) => xterm.write(text) });
  const xterm = useXterm(tab, 'own');
  return <XtermBox xterm={xterm} error={tab.error} />;
}

function XtermBox({ xterm, error }: { readonly xterm: Xterm; readonly error: string | null }): JSX.Element {
  return (
    <>
      {error && (
        <div className="term-pane__error" role="status">
          Terminal unavailable: {error}
        </div>
      )}
      <div className="term-pane__host" onMouseDown={xterm.focus}>
        <div ref={xterm.hostRef} className="term-pane__mount" />
      </div>
    </>
  );
}
